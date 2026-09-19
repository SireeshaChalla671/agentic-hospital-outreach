import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

const STALE_LOCK_MINUTES = 5; // if a worker holds a task this long without finishing, assume it crashed

// Atomically reserves up to `hospital.outboundCapacity - activeCount` tasks for this hospital,
// using SKIP LOCKED so concurrent workers never double-claim the same task.
export async function reserveTasks(hospitalId: string, workerId: string) {
  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital) return [];

  const activeCount = await prisma.outreachTask.count({
    where: {
      campaign: { hospitalId },
      status: { in: ["CALLING", "CONNECTED"] },
    },
  });

  const availableCapacity = hospital.outboundCapacity - activeCount;
  if (availableCapacity <= 0) return [];

  const reserved = await prisma.$queryRaw<{ id: string; patientId: string; campaignId: string }[]>(
    Prisma.sql`
      WITH selected AS (
        SELECT ot.id
        FROM "OutreachTask" ot
        JOIN "Campaign" c ON ot."campaignId" = c.id
        WHERE c."hospitalId" = ${hospitalId}
          AND c.status = 'RUNNING'
          AND ot.status IN ('PENDING', 'RETRY_SCHEDULED', 'CALLBACK_SCHEDULED')
          AND (ot."scheduledFor" IS NULL OR ot."scheduledFor" <= NOW())
        ORDER BY ot."priorityScore" DESC
        LIMIT ${availableCapacity}
        FOR UPDATE OF ot SKIP LOCKED
      )
      UPDATE "OutreachTask" ot
      SET status = 'CALLING', "lockedBy" = ${workerId}, "lockedAt" = NOW(), "updatedAt" = NOW()
      FROM selected
      WHERE ot.id = selected.id
      RETURNING ot.id, ot."patientId", ot."campaignId";
    `
  );

  return reserved;
}

type CallOutcome =
  | "COMPLETED" | "NO_ANSWER" | "BUSY" | "VOICEMAIL" | "DROPPED"
  | "ESCALATED" | "FAILED";

// Backoff schedule: each retry waits longer than the last (in minutes)
const BACKOFF_MINUTES = [15, 60, 240]; // 15min, 1hr, 4hr

export async function recordOutcome(taskId: string, outcome: CallOutcome, opts?: { callbackAt?: Date }) {
  const task = await prisma.outreachTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("Task not found");

  const newAttemptCount = task.attemptCount + 1;

  // Terminal, successful outcomes
  if (outcome === "COMPLETED" || outcome === "ESCALATED") {
    return prisma.outreachTask.update({
      where: { id: taskId },
      data: {
        status: outcome,
        attemptCount: newAttemptCount,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  // Explicit callback request — bypasses generic backoff, goes to the exact requested time
  if (opts?.callbackAt) {
    return prisma.outreachTask.update({
      where: { id: taskId },
      data: {
        status: "CALLBACK_SCHEDULED",
        attemptCount: newAttemptCount,
        scheduledFor: opts.callbackAt,
        callbackRequestedAt: opts.callbackAt,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  // Retryable outcomes: NO_ANSWER, BUSY, VOICEMAIL, DROPPED, FAILED
  if (newAttemptCount >= task.maxAttempts) {
    // Max retries exhausted -> visible manual follow-up (Section 11 requirement)
    return prisma.outreachTask.update({
      where: { id: taskId },
      data: {
        status: "MANUAL_FOLLOW_UP",
        attemptCount: newAttemptCount,
        lockedBy: null,
        lockedAt: null,
      },
    });
  }

  const backoffMinutes = BACKOFF_MINUTES[Math.min(task.attemptCount, BACKOFF_MINUTES.length - 1)];
  const scheduledFor = new Date(Date.now() + backoffMinutes * 60 * 1000);

  return prisma.outreachTask.update({
    where: { id: taskId },
    data: {
      status: "RETRY_SCHEDULED",
      attemptCount: newAttemptCount,
      scheduledFor,
      lockedBy: null,
      lockedAt: null,
    },
  });
}

// Crash recovery: finds tasks stuck "CALLING" whose worker never reported back
// (worker likely crashed while holding the lock) and releases them for retry.
export async function recoverStaleLocks() {
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000);

  const stale = await prisma.outreachTask.findMany({
    where: { status: "CALLING", lockedAt: { lt: staleThreshold } },
  });

  for (const task of stale) {
    const newAttemptCount = task.attemptCount + 1;
    if (newAttemptCount >= task.maxAttempts) {
      await prisma.outreachTask.update({
        where: { id: task.id },
        data: { status: "MANUAL_FOLLOW_UP", attemptCount: newAttemptCount, lockedBy: null, lockedAt: null },
      });
    } else {
      await prisma.outreachTask.update({
        where: { id: task.id },
        data: {
          status: "PENDING",
          attemptCount: newAttemptCount,
          scheduledFor: new Date(),
          lockedBy: null,
          lockedAt: null,
        },
      });
    }
  }

  return stale.length;
}