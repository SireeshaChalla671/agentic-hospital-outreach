import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";
import { getEligiblePatients } from "./eligibility";

const router = Router();

const createCampaignSchema = z.object({
  hospitalId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  eligibilityCriteria: z.object({
    riskLevels: z.array(z.enum(["low", "medium", "high"])).optional(),
    careSettings: z.array(z.string()).optional(),
    maxHoursSinceDischarge: z.number().positive().optional(),
  }).default({}),
  followUpWindowHours: z.number().int().positive().default(72),
  priority: z.number().int().min(1).max(10).default(5),
  maxRetries: z.number().int().min(0).default(3),
  outboundCapacity: z.number().int().positive().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

router.post("/", requireAuth, requireRole("HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "PLATFORM_ADMIN"), async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const data = parsed.data;

  if (req.user!.role !== "PLATFORM_ADMIN" && data.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const campaign = await prisma.campaign.create({
    data: {
      ...data,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      status: "DRAFT",
    },
  });

  await prisma.auditLog.create({
    data: {
      hospitalId: campaign.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "campaign.created",
      entityType: "Campaign",
      entityId: campaign.id,
    },
  });

  res.status(201).json(campaign);
});

router.get("/", requireAuth, async (req, res) => {
  const hospitalId = req.user!.role === "PLATFORM_ADMIN"
    ? (req.query.hospitalId as string | undefined)
    : req.user!.hospitalId;

  if (!hospitalId) return res.status(400).json({ error: "hospitalId required" });

  const campaigns = await prisma.campaign.findMany({
    where: { hospitalId },
    orderBy: { createdAt: "desc" },
  });

  res.json(campaigns);
});

router.get("/:id", requireAuth, async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  res.json(campaign);
});

// Workload estimate before activation — Section 8 requirement
router.get("/:id/estimate", requireAuth, async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const eligiblePatients = await getEligiblePatients(campaign);

  res.json({
    campaignId: campaign.id,
    eligiblePatientCount: eligiblePatients.length,
    expectedAttempts: eligiblePatients.length * (campaign.maxRetries + 1),
    outboundCapacity: campaign.outboundCapacity,
  });
});

// Activate: DRAFT/READY -> RUNNING, and materialize OutreachTasks for eligible patients
router.post("/:id/activate", requireAuth, requireRole("HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "PLATFORM_ADMIN"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (!["DRAFT", "READY", "PAUSED"].includes(campaign.status)) {
    return res.status(400).json({ error: `Cannot activate campaign in status ${campaign.status}` });
  }

  const eligiblePatients = await getEligiblePatients(campaign);

  const existingTasks = await prisma.outreachTask.findMany({
    where: { campaignId: campaign.id },
    select: { patientId: true },
  });
  const existingPatientIds = new Set(existingTasks.map((t) => t.patientId));

  const newPatients = eligiblePatients.filter((p) => !existingPatientIds.has(p.id));

  let created = 0;
  for (const patient of newPatients) {
    const encounter = patient.encounters[0];
    if (!encounter) continue;

    const clinicalDeadline = new Date(
      encounter.dischargeTimestamp.getTime() + encounter.followUpWindowHours * 60 * 60 * 1000
    );

    await prisma.outreachTask.create({
      data: {
        campaignId: campaign.id,
        patientId: patient.id,
        status: "PENDING",
        maxAttempts: campaign.maxRetries + 1,
        clinicalDeadline,
        scheduledFor: new Date(),
      },
    });
    created++;
  }

  const updated = await prisma.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING" },
  });

  await prisma.auditLog.create({
    data: {
      hospitalId: campaign.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "campaign.activated",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { tasksCreated: created },
    },
  });

  res.json({ campaign: updated, tasksCreated: created });
});

router.post("/:id/pause", requireAuth, requireRole("HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "PLATFORM_ADMIN"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (campaign.status !== "RUNNING") {
    return res.status(400).json({ error: `Cannot pause campaign in status ${campaign.status}` });
  }

  const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });

  await prisma.auditLog.create({
    data: {
      hospitalId: campaign.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "campaign.paused",
      entityType: "Campaign",
      entityId: campaign.id,
    },
  });

  res.json(updated);
});

router.post("/:id/resume", requireAuth, requireRole("HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "PLATFORM_ADMIN"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (campaign.status !== "PAUSED") {
    return res.status(400).json({ error: `Cannot resume campaign in status ${campaign.status}` });
  }

  const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING" } });

  await prisma.auditLog.create({
    data: {
      hospitalId: campaign.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "campaign.resumed",
      entityType: "Campaign",
      entityId: campaign.id,
    },
  });

  res.json(updated);
});

router.post("/:id/cancel", requireAuth, requireRole("HOSPITAL_ADMIN", "CAMPAIGN_MANAGER", "PLATFORM_ADMIN"), async (req, res) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && campaign.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  if (["COMPLETED", "CANCELLED", "FAILED"].includes(campaign.status)) {
    return res.status(400).json({ error: `Cannot cancel campaign in status ${campaign.status}` });
  }

  const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "CANCELLED" } });

  await prisma.auditLog.create({
    data: {
      hospitalId: campaign.hospitalId,
      actorType: "user",
      actorId: req.user!.id,
      action: "campaign.cancelled",
      entityType: "Campaign",
      entityId: campaign.id,
    },
  });

  res.json(updated);
});

export default router;