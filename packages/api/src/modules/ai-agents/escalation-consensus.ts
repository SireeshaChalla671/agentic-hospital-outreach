import { runClinicalTriage, TriageResult } from "./clinical-triage";
import type { ConversationResult } from "./voice-intake";

export interface ConsensusResult {
  assessments: TriageResult[];
  agreement: boolean;
  disagreementDetails?: string;
  finalClassification: "routine" | "concerning" | "urgent" | "uncertain";
  finalEscalationDecision: boolean;
  consensusReasoning: string;
}

const CLASSIFICATION_SEVERITY: Record<string, number> = {
  routine: 0,
  uncertain: 1,
  concerning: 2,
  urgent: 3,
};

interface ConsensusInput {
  conversation: ConversationResult;
  protocolContent: string;
  redFlags: string[];
}

/**
 * Runs two independent triage assessments (different reasoning framings, same
 * underlying model in this prototype — documented as a known limitation) and
 * compares results. Any disagreement, or any "uncertain"/"urgent"/"concerning"
 * result from either assessment, triggers conservative escalation.
 * This directly implements Section 16: disagreement must be detected and
 * handled, never hidden, and the system must default to the safer path.
 */
export async function runEscalationConsensus(input: ConsensusInput): Promise<ConsensusResult> {
  // Assessment A: standard clinical framing
  const assessmentA = await runClinicalTriage({
    conversation: input.conversation,
    protocolContent: input.protocolContent,
    redFlags: input.redFlags,
  });

  // Assessment B: adversarial/red-team framing — explicitly asked to look for
  // reasons to escalate, acting as an independent check against false negatives.
  const assessmentB = await runClinicalTriage({
    conversation: input.conversation,
    protocolContent:
      input.protocolContent +
      "\n\nIMPORTANT: Review this conversation specifically for any reason a cautious clinician would want to escalate, even subtle ones. Err toward caution.",
    redFlags: input.redFlags,
  });

  const assessments = [assessmentA, assessmentB];

  const severities = assessments.map((a) => CLASSIFICATION_SEVERITY[a.classification]);
  const maxSeverity = Math.max(...severities);
  const agreement = severities[0] === severities[1];

  const anyEscalationRecommended = assessments.some((a) => a.escalationRecommended);
  const anyLowConfidence = assessments.some((a) => a.confidence < 0.6);

  // Conservative consensus rule: escalate if either assessment recommends it,
  // if they disagree, if confidence is low, or if the worst classification is
  // concerning/urgent/uncertain. This is deliberately biased toward escalation
  // over silence, per the PRD's patient-safety-first principle (Section 2, 16).
  const finalEscalationDecision =
    anyEscalationRecommended || !agreement || anyLowConfidence || maxSeverity >= 1;

  const worstClassification = Object.keys(CLASSIFICATION_SEVERITY).find(
    (k) => CLASSIFICATION_SEVERITY[k] === maxSeverity
  ) as ConsensusResult["finalClassification"];

  let consensusReasoning: string;
  let disagreementDetails: string | undefined;

  if (!agreement) {
    disagreementDetails = `Assessment A classified as "${assessmentA.classification}" while Assessment B classified as "${assessmentB.classification}". Applying conservative escalation per disagreement policy.`;
    consensusReasoning = `Disagreement detected between independent assessments. ${disagreementDetails}`;
  } else if (finalEscalationDecision) {
    consensusReasoning = `Both assessments agree on classification "${worstClassification}". Escalating due to: ${
      anyEscalationRecommended ? "explicit escalation recommendation, " : ""
    }${anyLowConfidence ? "low confidence in at least one assessment, " : ""}${
      maxSeverity >= 1 ? "non-routine classification." : ""
    }`;
  } else {
    consensusReasoning = `Both independent assessments agree on "routine" classification with sufficient confidence. No escalation required.`;
  }

  return {
    assessments,
    agreement,
    disagreementDetails,
    finalClassification: worstClassification,
    finalEscalationDecision,
    consensusReasoning,
  };
}