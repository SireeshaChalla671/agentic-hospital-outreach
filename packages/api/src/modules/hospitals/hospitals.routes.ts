import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole } from "../../middleware/auth";

const router = Router();

const createHospitalSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default("UTC"),
  callingHoursStart: z.string().default("09:00"),
  callingHoursEnd: z.string().default("18:00"),
  outboundCapacity: z.number().int().positive().default(10),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
});

// Only Platform Admins create hospitals
router.post("/", requireAuth, requireRole("PLATFORM_ADMIN"), async (req, res) => {
  const parsed = createHospitalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const hospital = await prisma.hospital.create({ data: parsed.data });

  await prisma.auditLog.create({
    data: {
      hospitalId: hospital.id,
      actorType: "user",
      actorId: req.user!.id,
      action: "hospital.created",
      entityType: "Hospital",
      entityId: hospital.id,
    },
  });

  res.status(201).json(hospital);
});

// Platform admin sees all; hospital staff see only their own
router.get("/", requireAuth, async (req, res) => {
  if (req.user!.role === "PLATFORM_ADMIN") {
    const hospitals = await prisma.hospital.findMany({ orderBy: { createdAt: "desc" } });
    return res.json(hospitals);
  }

  if (!req.user!.hospitalId) {
    return res.status(403).json({ error: "No hospital assigned" });
  }

  const hospital = await prisma.hospital.findUnique({ where: { id: req.user!.hospitalId } });
  res.json(hospital ? [hospital] : []);
});

router.get("/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && req.user!.hospitalId !== id) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const hospital = await prisma.hospital.findUnique({ where: { id } });
  if (!hospital) return res.status(404).json({ error: "Not found" });
  res.json(hospital);
});

const updateHospitalSchema = createHospitalSchema.partial().extend({
  status: z.enum(["ONBOARDING", "CONFIGURED", "READY", "SUSPENDED"]).optional(),
});

router.patch("/:id", requireAuth, requireRole("PLATFORM_ADMIN", "HOSPITAL_ADMIN"), async (req, res) => {
  const { id } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && req.user!.hospitalId !== id) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const parsed = updateHospitalSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const hospital = await prisma.hospital.update({ where: { id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      hospitalId: id,
      actorType: "user",
      actorId: req.user!.id,
      action: "hospital.updated",
      entityType: "Hospital",
      entityId: id,
      metadata: parsed.data,
    },
  });

  res.json(hospital);
});

export default router;