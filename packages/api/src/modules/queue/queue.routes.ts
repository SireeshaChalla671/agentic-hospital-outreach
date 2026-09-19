import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { reserveTasks, recordOutcome, recoverStaleLocks } from "./queue.service";
import { recomputeAllPriorities } from "./priority";

const router = Router();

// Recompute priority scores for all pending/retry/callback tasks in this hospital
router.post("/:hospitalId/recompute", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const count = await recomputeAllPriorities(hospitalId);
  res.json({ recomputed: count });
});

// A worker claims up to its available capacity worth of tasks
router.post("/:hospitalId/claim", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const workerId = (req.body?.workerId as string) || `worker-${Date.now()}`;
  const tasks = await reserveTasks(hospitalId, workerId);

  res.json({ workerId, claimed: tasks.length, tasks });
});

const outcomeSchema = z.object({
  outcome: z.enum(["COMPLETED", "NO_ANSWER", "BUSY", "VOICEMAIL", "DROPPED", "ESCALATED", "FAILED"]),
  callbackAt: z.string().datetime().optional(),
});

// Record the result of a call attempt (drives retry/backoff/manual-follow-up logic)
router.post("/tasks/:taskId/outcome", requireAuth, async (req, res) => {
  const parsed = outcomeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const task = await prisma.outreachTask.findUnique({
    where: { id: req.params.taskId },
    include: { campaign: true },
  });
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && task.campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const updated = await recordOutcome(
    task.id,
    parsed.data.outcome,
    parsed.data.callbackAt ? { callbackAt: new Date(parsed.data.callbackAt) } : undefined
  );

  res.json(updated);
});

// Recover tasks stuck in CALLING due to a crashed worker
router.post("/recover-stale", requireAuth, async (_req, res) => {
  const recovered = await recoverStaleLocks();
  res.json({ recovered });
});

// Queue state visibility for dashboards
router.get("/:hospitalId/state", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const [byStatus, hospital] = await Promise.all([
    prisma.outreachTask.groupBy({
      by: ["status"],
      where: { campaign: { hospitalId } },
      _count: true,
    }),
    prisma.hospital.findUnique({ where: { id: hospitalId } }),
  ]);

  const activeCalls = byStatus.find((s) => s.status === "CALLING")?._count ?? 0;

  const oldestPending = await prisma.outreachTask.findFirst({
    where: { campaign: { hospitalId }, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  const cutoffRiskCount = await prisma.outreachTask.count({
    where: {
      campaign: { hospitalId },
      status: { in: ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"] },
      clinicalDeadline: { lte: new Date(Date.now() + 2 * 60 * 60 * 1000) }, // within 2 hours of deadline
    },
  });

  res.json({
    hospitalId,
    outboundCapacity: hospital?.outboundCapacity,
    activeCalls,
    statusBreakdown: byStatus.map((s) => ({ status: s.status, count: s._count })),
    oldestPendingTaskAge: oldestPending
      ? Math.round((Date.now() - oldestPending.createdAt.getTime()) / 60000) + " min"
      : null,
    tasksNearCutoff: cutoffRiskCount,
  });
});

export default router;