import { prisma } from "../../lib/prisma";

/**
 * Mock EHR abstraction layer (Section 6).
 * Designed to be replaceable: a real EHR integration would implement the same
 * read/write interface. All writes are recorded as EhrSyncRecord for
 * observability, and failures are represented explicitly rather than swallowed.
 */

export interface EhrPatientView {
  patientId: string;
  mrn: string;
  name: string;
  conditions: string[];
  medications: string[];
  lastEncounter: {
    careSetting: string;
    dischargeTimestamp: Date;
    riskLevel: string;
  } | null;
}

// READ: retrieve a patient's record as the EHR would expose it
export async function getPatientFromEhr(patientId: string): Promise<EhrPatientView | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { encounters: { orderBy: { dischargeTimestamp: "desc" }, take: 1 } },
  });

  if (!patient) return null;

  const encounter = patient.encounters[0];

  return {
    patientId: patient.id,
    mrn: patient.mrn,
    name: `${patient.firstName} ${patient.lastName}`,
    conditions: encounter?.conditions ?? [],
    medications: encounter?.medications ?? [],
    lastEncounter: encounter
      ? {
          careSetting: encounter.careSetting,
          dischargeTimestamp: encounter.dischargeTimestamp,
          riskLevel: encounter.riskLevel,
        }
      : null,
  };
}

// WRITE: record a structured outreach result back to the "EHR".
// Always logs the attempt (success or failure) for observability (Section 23).
export async function writeToEhr(
  hospitalId: string,
  patientId: string,
  type: "COMMUNICATION" | "OBSERVATION" | "FOLLOW_UP_TASK" | "ESCALATION_RECORD" | "ENCOUNTER_UPDATE",
  payload: Record<string, unknown>
) {
  try {
    // In a real integration this would call an external API. Here we simulate
    // that boundary explicitly so the failure path is real and testable.
    if (process.env.SIMULATE_EHR_FAILURE === "true") {
      throw new Error("Simulated EHR outage");
    }

    const record = await prisma.ehrSyncRecord.create({
      data: { hospitalId, patientId, type, payload: payload as any, success: true },
    });

    return record;
  } catch (err: any) {
    const record = await prisma.ehrSyncRecord.create({
      data: {
        hospitalId,
        patientId,
        type,
        payload: payload as any,
        success: false,
        error: String(err?.message || err),
      },
    });
    return record;
  }
}

export async function getEhrSyncHistory(hospitalId: string, patientId?: string) {
  return prisma.ehrSyncRecord.findMany({
    where: { hospitalId, ...(patientId ? { patientId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}