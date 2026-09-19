import { prisma } from "../../lib/prisma";

const RISK_WEIGHT: Record<string, number> = { high: 30, medium: 15, low: 5 };

// Deadline urgency: as hoursRemaining shrinks toward 0, urgency approaches its max.
// A task already past its deadline gets the maximum urgency score (still worth trying / flag for escalation).
function deadlineUrgencyScore(hoursRemaining: number): number {
  if (hoursRemaining <= 0) return 40;
  if (hoursRemaining <= 2) return 38;
  if (hoursRemaining <= 6) return 32;
  if (hoursRemaining <= 12) return 24;
  if (hoursRemaining <= 24) return 15;
  if (hoursRemaining <= 48) return 8;
  return 3;
}

// Slight penalty per retry — keeps repeatedly-unreachable patients from perpetually
// blocking fresh patients, without starving them entirely (prevents starvation both ways).
function retryPenalty(attemptCount: number): number {
  return Math.min(attemptCount * 4, 15);
}

export async function computePriorityScore(taskId: string): Promise<number> {
  const task = await prisma.outreachTask.findUnique({
    where: { id: taskId },
    include: {
      campaign: true,
      patient: { include: { encounters: { orderBy: { dischargeTimestamp: "desc" }, take: 1 } } },
    },
  });

  if (!task) return 0;

  const encounter = task.patient.encounters[0];
  const riskLevel = encounter?.riskLevel ?? "low";

  const hoursRemaining = (task.clinicalDeadline.getTime() - Date.now()) / (1000 * 60 * 60);

  let score = 0;
  score += RISK_WEIGHT[riskLevel] ?? 5;
  score += deadlineUrgencyScore(hoursRemaining);
  score += task.campaign.priority * 2; // campaign priority 1-10 -> up to 20 points
  score -= retryPenalty(task.attemptCount);

  // Callback requests get a strong boost once their requested time has arrived,
  // so they aren't stuck behind the generic queue (Section 11 requirement).
  if (task.callbackRequestedAt && task.callbackRequestedAt.getTime() <= Date.now()) {
    score += 25;
  }

  return Math.round(score * 100) / 100;
}

// Recomputes scores for every task currently eligible to be worked, so the queue
// order reflects current deadline pressure rather than a stale score from creation time.
export async function recomputeAllPriorities(hospitalId?: string): Promise<number> {
  const tasks = await prisma.outreachTask.findMany({
    where: {
      status: { in: ["PENDING", "RETRY_SCHEDULED", "CALLBACK_SCHEDULED"] },
      ...(hospitalId ? { campaign: { hospitalId } } : {}),
    },
    select: { id: true },
  });

  for (const t of tasks) {
    const score = await computePriorityScore(t.id);
    await prisma.outreachTask.update({ where: { id: t.id }, data: { priorityScore: score } });
  }

  return tasks.length;
}