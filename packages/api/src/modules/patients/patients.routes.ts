import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";

const router = Router();

// List patients — always tenant-scoped, never trusts a client-supplied hospitalId
router.get("/", requireAuth, async (req, res) => {
  const hospitalId = req.user!.role === "PLATFORM_ADMIN"
    ? (req.query.hospitalId as string | undefined)
    : req.user!.hospitalId;

  if (!hospitalId) {
    return res.status(400).json({ error: "hospitalId required" });
  }

  const page = parseInt((req.query.page as string) || "1");
  const pageSize = Math.min(parseInt((req.query.pageSize as string) || "25"), 100);

  const [patients, total] = await Promise.all([
    prisma.patient.findMany({
      where: { hospitalId },
      include: { encounters: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.patient.count({ where: { hospitalId } }),
  ]);

  res.json({ patients, total, page, pageSize });
});

router.get("/:id", requireAuth, async (req, res) => {
  const patient = await prisma.patient.findUnique({
    where: { id: req.params.id },
    include: { encounters: true, outreachTasks: true, calls: true, escalations: true },
  });

  if (!patient) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && patient.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  res.json(patient);
});

const createPatientSchema = z.object({
  hospitalId: z.string().uuid(),
  mrn: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  preferredContactTime: z.string().optional(),
  encounter: z.object({
    careSetting: z.string(),
    dischargeTimestamp: z.string().datetime(),
    followUpWindowHours: z.number().int().positive().default(72),
    conditions: z.array(z.string()).default([]),
    medications: z.array(z.string()).default([]),
    riskLevel: z.enum(["low", "medium", "high"]).default("low"),
    instructions: z.string().optional(),
  }),
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = createPatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const { encounter, ...patientData } = parsed.data;

  if (req.user!.role !== "PLATFORM_ADMIN" && patientData.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const patient = await prisma.patient.create({
    data: {
      ...patientData,
      encounters: { create: { ...encounter, dischargeTimestamp: new Date(encounter.dischargeTimestamp) } },
    },
    include: { encounters: true },
  });

  res.status(201).json(patient);
});

export default router;