import { sendNotification } from "../notifications/notifications.service";
import { writeToEhr } from "../ehr/ehr.service";
import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { runVoiceIntake } from "../ai-agents/voice-intake";
import { runEscalationConsensus } from "../ai-agents/escalation-consensus";
import { generateDocumentation } from "../ai-agents/documentation";
import { retrieveRelevantProtocol } from "../ai-agents/protocol-retrieval";
import { recordOutcome } from "../queue/queue.service";

const router = Router();

// Conducts a full simulated AI call for a claimed (CALLING) outreach task:
// Voice Intake -> Escalation Consensus (2 independent triage assessments) ->
// Documentation -> persists Call record -> creates Escalation if needed ->
// records the outcome back to the queue (Section 13-19 pipeline).
router.post("/conduct/:taskId", requireAuth, async (req, res) => {
  const task = await prisma.outreachTask.findUnique({
    where: { id: req.params.taskId },
    include: {
      campaign: { include: { hospital: true } },
      patient: { include: { encounters: { orderBy: { dischargeTimestamp: "desc" }, take: 1 } } },
    },
  });

  if (!task) return res.status(404).json({ error: "Task not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && task.campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (task.status !== "CALLING") {
    return res.status(400).json({ error: `Task must be in CALLING status, currently ${task.status}` });
  }

  const encounter = task.patient.encounters[0];
  if (!encounter) return res.status(400).json({ error: "Patient has no encounter record" });

  try {
    const protocol = await retrieveRelevantProtocol(task.campaign.hospitalId, encounter.conditions, encounter.careSetting);

    if (!protocol) {
      return res.status(422).json({ error: "No protocol available for this hospital; cannot conduct AI-grounded call" });
    }

    // 1. Voice Intake — simulated conversation
       // Fetch prior call history for this patient (persistent context, Section 17) —
    // task-specific: only this patient's own recent calls, not their whole chart.
    const priorCallRecords = await prisma.call.findMany({
      where: { patientId: task.patientId, id: { not: undefined } },
      orderBy: { startedAt: "desc" },
      take: 3,
    });
    const priorCalls = priorCallRecords.map((c) => ({
      date: c.startedAt.toISOString().split("T")[0],
      outcome: c.outcome,
      reportedSymptoms: ((c.transcript as any)?.reportedSymptoms as string[]) || [],
      documentation: c.documentation,
    }));

    // 1. Voice Intake — simulated conversation
    const conversation = await runVoiceIntake({
      patientFirstName: task.patient.firstName,
      conditions: encounter.conditions,
      medications: encounter.medications,
      careSetting: encounter.careSetting,
      riskLevel: encounter.riskLevel,
      protocolContent: protocol.content,
      simulatedScenario: req.body?.simulatedScenario,
      priorCalls,
    });

    // 2. Escalation Consensus — 2 independent triage assessments compared
    const consensus = await runEscalationConsensus({
      conversation,
      protocolContent: protocol.content,
      redFlags: protocol.redFlags,
    });

    // 3. Documentation
    const documentation = await generateDocumentation({
      patientFirstName: task.patient.firstName,
      conversation,
      consensus,
    });

    // Determine call outcome
    const callOutcome = consensus.finalEscalationDecision ? "ESCALATED" : "COMPLETED";

    // Persist the Call record — full traceability from conclusion back to evidence
    const call = await prisma.call.create({
      data: {
        outreachTaskId: task.id,
        campaignId: task.campaignId,
        patientId: task.patientId,
        outcome: callOutcome,
        transcript: conversation.transcript as any,
        triageResult: consensus.assessments as any,
        escalationResult: consensus as any,
        documentation,
        endedAt: new Date(),
      },
    });
    // Write the outreach result back to the mock EHR (Section 6, 19)
    await writeToEhr(task.campaign.hospitalId, task.patientId, "COMMUNICATION", {
      callId: call.id,
      outcome: callOutcome,
      documentation,
      reportedSymptoms: conversation.reportedSymptoms,
    });

    if (consensus.finalClassification !== "routine") {
      await writeToEhr(task.campaign.hospitalId, task.patientId, "OBSERVATION", {
        callId: call.id,
        classification: consensus.finalClassification,
        indicators: consensus.assessments.flatMap((a) => a.observedIndicators),
      });
    }

    // Create Escalation record if consensus says so — controlled tool pattern:
    // AI never writes directly, this backend code validates and executes.
    let escalation = null;
    if (consensus.finalEscalationDecision) {
      escalation = await prisma.escalation.create({
        data: {
          hospitalId: task.campaign.hospitalId,
          campaignId: task.campaignId,
          patientId: task.patientId,
          status: "OPEN",
          classification: consensus.finalClassification.toUpperCase() as any,
          triggerReason: consensus.consensusReasoning,
          evidence: {
            assessments: consensus.assessments,
            agreement: consensus.agreement,
            disagreementDetails: consensus.disagreementDetails,
            callId: call.id,
          } as any,
        },
      });

           await prisma.auditLog.create({
        data: {
          hospitalId: task.campaign.hospitalId,
          actorType: "ai",
          action: "escalation.created",
          entityType: "Escalation",
          entityId: escalation.id,
          metadata: { classification: consensus.finalClassification, agreement: consensus.agreement },
        },
      });
    }

    if (escalation) {
      // Initial notification to the clinical review team (Section 20/21)
      await sendNotification({
        hospitalId: task.campaign.hospitalId,
        escalationId: escalation.id,
        recipientRole: "CLINICAL_REVIEWER",
        channel: "dashboard",
        message: `New ${consensus.finalClassification} escalation for ${task.patient.firstName} ${task.patient.lastName}: ${consensus.consensusReasoning}`,
      });
    }

    // Record outcome back to queue engine (moves task to ESCALATED or COMPLETED)
    const updatedTask = await recordOutcome(task.id, callOutcome as any);

    res.json({
      call,
      escalation,
      task: updatedTask,
      consensus,
    });
  } catch (err: any) {
    // AI failure -> explicit FAILED outcome, never silently accepted (Section 15/24)
    await recordOutcome(task.id, "FAILED");
    res.status(502).json({ error: "AI call pipeline failed", details: String(err?.message || err) });
  }
});

export default router;