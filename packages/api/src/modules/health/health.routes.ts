import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { aiUsageLog } from "../../lib/ai";

const router = Router();

// Basic liveness check (already exists at /health, this is the richer
// system-health view referenced in Section 23).
router.get("/system", requireAuth, requireRole("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res) => {
  const hospitalId = req.user!.role === "PLATFORM_ADMIN"
    ? (req.query.hospitalId as string | undefined)
    : req.user!.hospitalId;

  let dbHealthy = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbHealthy = false;
  }

  const recentAiCalls = aiUsageLog.slice(-50);
  const recentFailureRate =
    recentAiCalls.length > 0
      ? recentAiCalls.filter((l) => !l.success).length / recentAiCalls.length
      : 0;

  const stuckTasks = hospitalId
    ? await prisma.outreachTask.count({
        where: {
          campaign: { hospitalId },
          status: "CALLING",
          lockedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
      })
    : 0;

  const failedEhrWrites = hospitalId
    ? await prisma.ehrSyncRecord.count({ where: { hospitalId, success: false } })
    : 0;

  // Overall system state
  let status: "Healthy" | "Degraded" | "Unavailable" = "Healthy";
  if (!dbHealthy) status = "Unavailable";
  else if (recentFailureRate > 0.3 || stuckTasks > 0 || failedEhrWrites > 5) status = "Degraded";

  const queueHealth = hospitalId
    ? {
        activeCalls: await prisma.outreachTask.count({
          where: { campaign: { hospitalId }, status: "CALLING" },
        }),
        pendingCapacityLimit: (await prisma.hospital.findUnique({ where: { id: hospitalId } }))
          ?.outboundCapacity,
        stuckTasks,
        failedTasks: await prisma.outreachTask.count({
          where: { campaign: { hospitalId }, status: "FAILED" },
        }),
      }
    : null;

  res.json({
    status,
    checkedAt: new Date().toISOString(),
    database: dbHealthy ? "connected" : "unreachable",
    aiUsage: {
      recentCallsLogged: recentAiCalls.length,
      recentFailureRatePercent: Math.round(recentFailureRate * 10000) / 100,
    },
    queueHealth,
    ehrSyncFailures: failedEhrWrites,
  });
});

export default router;