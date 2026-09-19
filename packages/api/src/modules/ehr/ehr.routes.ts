import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { getPatientFromEhr, getEhrSyncHistory } from "./ehr.service";

const router = Router();

router.get("/patients/:patientId", requireAuth, async (req, res) => {
  const patient = await prisma.patient.findUnique({ where: { id: req.params.patientId } });
  if (!patient) return res.status(404).json({ error: "Not found" });

  if (req.user!.role !== "PLATFORM_ADMIN" && patient.hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const record = await getPatientFromEhr(req.params.patientId);
  res.json(record);
});

router.get("/sync-history/:hospitalId", requireAuth, async (req, res) => {
  const { hospitalId } = req.params;

  if (req.user!.role !== "PLATFORM_ADMIN" && hospitalId !== req.user!.hospitalId) {
    return res.status(403).json({ error: "Cross-tenant access denied" });
  }

  const patientId = req.query.patientId as string | undefined;
  const history = await getEhrSyncHistory(hospitalId, patientId);
  res.json(history);
});

export default router;