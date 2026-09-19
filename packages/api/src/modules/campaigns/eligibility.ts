import { prisma } from "../../lib/prisma";
import type { Campaign } from "@prisma/client";

interface EligibilityCriteria {
  riskLevels?: string[];
  careSettings?: string[];
  maxHoursSinceDischarge?: number;
}

// Determines which patients qualify for a campaign.
// Kept as a pure, explainable function: given a campaign + hospital patients, decide who's in.
export async function getEligiblePatients(campaign: Campaign) {
  const criteria = (campaign.eligibilityCriteria as EligibilityCriteria) || {};

  const patients = await prisma.patient.findMany({
    where: { hospitalId: campaign.hospitalId },
    include: { encounters: { orderBy: { dischargeTimestamp: "desc" }, take: 1 } },
  });

  const now = Date.now();

  return patients.filter((patient) => {
    const encounter = patient.encounters[0];
    if (!encounter) return false; // no discharge record, nothing to follow up on

    if (criteria.riskLevels && criteria.riskLevels.length > 0) {
      if (!criteria.riskLevels.includes(encounter.riskLevel)) return false;
    }

    if (criteria.careSettings && criteria.careSettings.length > 0) {
      if (!criteria.careSettings.includes(encounter.careSetting)) return false;
    }

    const hoursSinceDischarge = (now - encounter.dischargeTimestamp.getTime()) / (1000 * 60 * 60);

    if (criteria.maxHoursSinceDischarge !== undefined) {
      if (hoursSinceDischarge > criteria.maxHoursSinceDischarge) return false;
    }

    // Exclude patients already past their clinical follow-up window entirely
    if (hoursSinceDischarge > encounter.followUpWindowHours) return false;

    return true;
  });
}