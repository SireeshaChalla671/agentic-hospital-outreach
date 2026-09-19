import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { getNotifications, escalateUnacknowledgedNotifications } from "./notifications.service";

const router = Router();

router.get("/:hospitalId", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const escalationId = req.query.escalationId as string | undefined;
  const notifications = await getNotifications(hospitalId, escalationId);
  res.json(notifications);
});

// Manually trigger the unacknowledged-escalation check (would run on a
// schedule in production; exposed here so it's demonstrable/testable).
router.post("/check-unacknowledged", requireAuth, async (_req, res) => {
  const count = await escalateUnacknowledgedNotifications();
  res.json({ backupNotificationsSent: count });
});

export default router;