import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { aiUsageLog } from "../../lib/ai";

const router = Router();

router.get("/campaign/:campaignId", requireAuth, async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const [statusBreakdown, escalationCount, hospital] = await Promise.all([
    prisma.outreachTask.groupBy({
      by: ["status"],
      where: { campaignId: campaign.id },
      _count: true,
    }),
    prisma.escalation.count({ where: { campaignId: campaign.id } }),
    prisma.hospital.findUnique({ where: { id: campaign.hospitalId } }),
  ]);

  const totalTasks = statusBreakdown.reduce((sum, s) => sum + s._count, 0);
  const completed = statusBreakdown.find((s) => s.status === "COMPLETED")?._count ?? 0;
  const activeCalls = statusBreakdown.find((s) => s.status === "CALLING")?._count ?? 0;
  const manualFollowUp = statusBreakdown.find((s) => s.status === "MANUAL_FOLLOW_UP")?._count ?? 0;
  const pending = statusBreakdown.find((s) => s.status === "PENDING")?._count ?? 0;
  const retryScheduled = statusBreakdown.find((s) => s.status === "RETRY_SCHEDULED")?._count ?? 0;

  const oldestPending = await prisma.outreachTask.findFirst({
    where: { campaignId: campaign.id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  const cutoffRisk = await prisma.outreachTask.count({
    where: {
      campaignId: campaign.id,
      status: { in: ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"] },
      clinicalDeadline: { lte: new Date(Date.now() + 2 * 60 * 60 * 1000) },
    },
  });

  res.json({
    campaign,
    totalTasks,
    completed,
    activeCalls,
    manualFollowUp,
    pending,
    retryScheduled,
    escalationCount,
    outboundCapacity: campaign.outboundCapacity ?? hospital?.outboundCapacity,
    statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count })),
    oldestPendingTaskAge: oldestPending
      ? Math.round((Date.now() - oldestPending.createdAt.getTime()) / 60000) + " min"
      : null,
    tasksNearCutoff: cutoffRisk,
  });
});

router.get("/hospital/:hospitalId", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const [campaigns, totalPatients, escalationsByStatus, callOutcomes, ehrFailures] = await Promise.all([
    prisma.campaign.findMany({ where: { hospitalId }, orderBy: { createdAt: "desc" } }),
    prisma.patient.count({ where: { hospitalId } }),
    prisma.escalation.groupBy({ by: ["status"], where: { hospitalId }, _count: true }),
    prisma.call.groupBy({ by: ["outcome"], where: { campaign: { hospitalId } }, _count: true }),
    prisma.ehrSyncRecord.count({ where: { hospitalId, success: false } }),
  ]);

  const activeCampaigns = campaigns.filter((c) => c.status === "RUNNING").length;
  const openEscalations = escalationsByStatus
    .filter((e) => !["RESOLVED", "CLOSED"].includes(e.status))
    .reduce((sum, e) => sum + e._count, 0);

  res.json({
    hospitalId,
    totalPatients,
    totalCampaigns: campaigns.length,
    activeCampaigns,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, priority: c.priority })),
    escalationsByStatus: escalationsByStatus.map((e) => ({ status: e.status, count: e._count })),
    openEscalations,
    callOutcomeBreakdown: callOutcomes.map((c) => ({ outcome: c.outcome, count: c._count })),
    ehrSyncFailures: ehrFailures,
  });
});

router.get("/platform", requireAuth, requireRole("PLATFORM_ADMIN"), async (_req, res) => {
  const [hospitals, totalPatients, totalCampaigns, escalationsByStatus, taskStatusBreakdown, aiFailures] =
    await Promise.all([
      prisma.hospital.findMany(),
      prisma.patient.count(),
      prisma.campaign.count(),
      prisma.escalation.groupBy({ by: ["status"], _count: true }),
      prisma.outreachTask.groupBy({ by: ["status"], _count: true }),
      Promise.resolve(aiUsageLog.filter((l) => !l.success).length),
    ]);

  const recentAiCalls = aiUsageLog.slice(-50);
  const avgLatency =
    recentAiCalls.length > 0
      ? Math.round(recentAiCalls.reduce((sum, l) => sum + l.latencyMs, 0) / recentAiCalls.length)
      : 0;

  res.json({
    totalHospitals: hospitals.length,
    hospitals: hospitals.map((h) => ({ id: h.id, name: h.name, status: h.status, outboundCapacity: h.outboundCapacity })),
    totalPatients,
    totalCampaigns,
    escalationsByStatus: escalationsByStatus.map((e) => ({ status: e.status, count: e._count })),
    taskStatusBreakdown: taskStatusBreakdown.map((t) => ({ status: t.status, count: t._count })),
    aiUsage: {
      totalCallsLogged: aiUsageLog.length,
      recentFailures: aiFailures,
      avgLatencyMs: avgLatency,
    },
  });
});

router.get("/analytics/:campaignId", requireAuth, async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.campaignId } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const tasks = await prisma.outreachTask.findMany({ where: { campaignId: campaign.id } });
  const calls = await prisma.call.findMany({ where: { campaignId: campaign.id } });

  const totalAttempts = tasks.reduce((sum, t) => sum + t.attemptCount, 0);
  const avgAttempts = tasks.length > 0 ? Math.round((totalAttempts / tasks.length) * 100) / 100 : 0;

  const completedTasks = tasks.filter((t) => t.status === "COMPLETED" || t.status === "ESCALATED");
  const contactRate = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 10000) / 100 : 0;

  res.json({
    campaignId: campaign.id,
    eligiblePatients: tasks.length,
    attemptedOutreach: tasks.filter((t) => t.attemptCount > 0).length,
    completedOutreach: completedTasks.length,
    contactRatePercent: contactRate,
    avgAttemptsPerPatient: avgAttempts,
    totalCallsConducted: calls.length,
    escalationsGenerated: calls.filter((c) => c.outcome === "ESCALATED").length,
    manualFollowUps: tasks.filter((t) => t.status === "MANUAL_FOLLOW_UP").length,
  });
});

export default router;