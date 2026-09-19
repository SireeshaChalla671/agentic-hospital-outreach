import { prisma } from "../../lib/prisma";

/**
 * Notification delivery abstraction (Section 20/21). Simulated: notifications
 * are recorded as observable Notification rows (channel + message + delivered
 * flag) rather than actually sent via email/SMS provider -- see
 * known-limitations.md. This still demonstrates the required workflow
 * pattern: escalation created -> notify assigned/available reviewer ->
 * if not acknowledged within a timeout -> notify a backup.
 */
export async function sendNotification(params: {
  hospitalId: string;
  escalationId?: string;
  recipientRole?: string;
  recipientUserId?: string;
  channel: "dashboard" | "email" | "sms";
  message: string;
}) {
  return prisma.notification.create({
    data: {
      hospitalId: params.hospitalId,
      escalationId: params.escalationId,
      recipientRole: params.recipientRole,
      recipientUserId: params.recipientUserId,
      channel: params.channel,
      message: params.message,
      delivered: true, // simulated: always "delivered" in this prototype
    },
  });
}

const ACK_TIMEOUT_MINUTES = 15;

/**
 * Escalation notification chain: finds escalations still OPEN (never
 * assigned/acknowledged) longer than the timeout, and notifies a backup
 * reviewer. Callable on demand (like recoverStaleLocks); would run on a
 * schedule in production. Idempotent-ish: only escalates once per timeout
 * check by looking at whether a backup notification already exists.
 */
export async function escalateUnacknowledgedNotifications() {
  const cutoff = new Date(Date.now() - ACK_TIMEOUT_MINUTES * 60 * 1000);

  const staleEscalations = await prisma.escalation.findMany({
    where: { status: "OPEN", createdAt: { lt: cutoff } },
    include: { hospital: true, patient: true },
  });

  let notifiedCount = 0;

  for (const esc of staleEscalations) {
    const alreadyNotifiedBackup = await prisma.notification.findFirst({
      where: { escalationId: esc.id, recipientRole: "BACKUP_REVIEWER" },
    });
    if (alreadyNotifiedBackup) continue; // don't double-notify

    await sendNotification({
      hospitalId: esc.hospitalId,
      escalationId: esc.id,
      recipientRole: "BACKUP_REVIEWER",
      channel: "dashboard",
      message: `Escalation for ${esc.patient.firstName} ${esc.patient.lastName} (${esc.classification}) has not been acknowledged after ${ACK_TIMEOUT_MINUTES} minutes. Backup review needed.`,
    });
    notifiedCount++;
  }

  return notifiedCount;
}

export async function getNotifications(hospitalId: string, escalationId?: string) {
  return prisma.notification.findMany({
    where: { hospitalId, ...(escalationId ? { escalationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}