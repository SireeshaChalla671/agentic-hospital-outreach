import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const hospitalId = req.user!.role === "PLATFORM_ADMIN"
    ? (req.query.hospitalId as string | undefined)
    : req.user!.hospitalId;

  if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

  const statusFilter = req.query.status as string | undefined;

  const escalations = await prisma.escalation.findMany({
    where: {
      hospitalId,
      ...(statusFilter ? { status: statusFilter as any } : {}),
    },
    include: {
      patient: { select: { firstName: true, lastName: true, mrn: true } },
      campaign: { select: { name: true } },
      assignedReviewer: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(escalations);
});

router.get("/:id", requireAuth, async (req, res) => {
  const escalation = await prisma.escalation.findUnique({
    where: { id: req.params.id },
    include: {
      patient: {
        include: {
          encounters: { orderBy: { dischargeTimestamp: "desc" }, take: 1 },
        },
      },
      campaign: true,
      assignedReviewer: { select: { id: true, name: true, email: true } },
      hospital: { select: { name: true } },
    },
  });

  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const evidence = escalation.evidence as any;
  const call = evidence?.callId
    ? await prisma.call.findUnique({ where: { id: evidence.callId } })
    : null;

  res.json({ ...escalation, call });
});

const assignSchema = z.object({ reviewerId: z.string().uuid() });

router.post("/:id/assign", requireAuth, requireRole("HOSPITAL_ADMIN", "CLINICAL_REVIEWER", "PLATFORM_ADMIN"), async (req, res) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const escalation = await prisma.escalation.findUnique({ where: { id: req.params.id } });
  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (!["OPEN", "ASSIGNED"].includes(escalation.status)) {
    return res.status(400).json({ error: `Cannot assign escalation in status ${escalation.status}` });
  }

  const updated = await prisma.escalation.update({
    where: { id: escalation.id },
    data: { status: "ASSIGNED", assignedReviewerId: parsed.data.reviewerId },
  });

  await prisma.auditLog.create({
    data: {
      hospitalId: escalation.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "escalation.assigned",
      entityType: "Escalation",
      entityId: escalation.id,
      metadata: { reviewerId: parsed.data.reviewerId },
    },
  });

  res.json(updated);
});

router.post("/:id/start-review", requireAuth, requireRole("CLINICAL_REVIEWER", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"), async (req, res) => {
  const escalation = await prisma.escalation.findUnique({ where: { id: req.params.id } });
  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (escalation.status !== "ASSIGNED") {
    return res.status(400).json({ error: `Cannot start review in status ${escalation.status}` });
  }

  const updated = await prisma.escalation.update({
    where: { id: escalation.id },
    data: { status: "IN_REVIEW" },
  });

  res.json(updated);
});

router.post("/:id/waiting-for-info", requireAuth, requireRole("CLINICAL_REVIEWER", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"), async (req, res) => {
  const escalation = await prisma.escalation.findUnique({ where: { id: req.params.id } });
  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const updated = await prisma.escalation.update({
    where: { id: escalation.id },
    data: { status: "WAITING_FOR_INFORMATION" },
  });

  res.json(updated);
});

const resolveSchema = z.object({
  resolution: z.string().min(1),
});

router.post("/:id/resolve", requireAuth, requireRole("CLINICAL_REVIEWER", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"), async (req, res) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const escalation = await prisma.escalation.findUnique({ where: { id: req.params.id } });
  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (["RESOLVED", "CLOSED"].includes(escalation.status)) {
    return res.status(400).json({ error: `Escalation already ${escalation.status}` });
  }

  const updated = await prisma.escalation.update({
    where: { id: escalation.id },
    data: {
      status: "RESOLVED",
      resolution: parsed.data.resolution,
      resolvedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      hospitalId: escalation.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "escalation.resolved",
      entityType: "Escalation",
      entityId: escalation.id,
      metadata: { resolution: parsed.data.resolution },
    },
  });

  res.json(updated);
});

router.post("/:id/close", requireAuth, requireRole("CLINICAL_REVIEWER", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"), async (req, res) => {
  const escalation = await prisma.escalation.findUnique({ where: { id: req.params.id } });
  if (!escalation) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && escalation.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (escalation.status !== "RESOLVED") {
    return res.status(400).json({ error: "Can only close a resolved escalation" });
  }

  const updated = await prisma.escalation.update({ where: { id: escalation.id }, data: { status: "CLOSED" } });
  res.json(updated);
});

export default router;