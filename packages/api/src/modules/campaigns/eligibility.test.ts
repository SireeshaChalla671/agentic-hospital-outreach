/**
 * Unit tests for campaign eligibility logic (Section 9, 28).
 * Tests the filtering rules in isolation without hitting the database,
 * by constructing patient/encounter fixtures directly.
 */

interface FakeEncounter {
  riskLevel: string;
  careSetting: string;
  dischargeTimestamp: Date;
  followUpWindowHours: number;
}

interface FakeCriteria {
  riskLevels?: string[];
  careSettings?: string[];
  maxHoursSinceDischarge?: number;
}

function isEligible(encounter: FakeEncounter, criteria: FakeCriteria, now: number): boolean {
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
  if (hoursSinceDischarge > encounter.followUpWindowHours) return false;
  return true;
}

describe("campaign eligibility filtering", () => {
  const now = Date.now();

  test("includes a patient matching risk level criteria", () => {
    const encounter: FakeEncounter = {
      riskLevel: "high",
      careSetting: "Cardiology",
      dischargeTimestamp: new Date(now - 5 * 60 * 60 * 1000),
      followUpWindowHours: 72,
    };
    expect(isEligible(encounter, { riskLevels: ["high", "medium"] }, now)).toBe(true);
  });

  test("excludes a patient whose risk level is not in criteria", () => {
    const encounter: FakeEncounter = {
      riskLevel: "low",
      careSetting: "Cardiology",
      dischargeTimestamp: new Date(now - 5 * 60 * 60 * 1000),
      followUpWindowHours: 72,
    };
    expect(isEligible(encounter, { riskLevels: ["high", "medium"] }, now)).toBe(false);
  });

  test("excludes a patient past their clinical follow-up window", () => {
    const encounter: FakeEncounter = {
      riskLevel: "high",
      careSetting: "Cardiology",
      dischargeTimestamp: new Date(now - 100 * 60 * 60 * 1000),
      followUpWindowHours: 72,
    };
    expect(isEligible(encounter, { riskLevels: ["high"] }, now)).toBe(false);
  });

  test("excludes a patient outside maxHoursSinceDischarge even if within follow-up window", () => {
    const encounter: FakeEncounter = {
      riskLevel: "high",
      careSetting: "Cardiology",
      dischargeTimestamp: new Date(now - 50 * 60 * 60 * 1000),
      followUpWindowHours: 72,
    };
    expect(isEligible(encounter, { riskLevels: ["high"], maxHoursSinceDischarge: 24 }, now)).toBe(
      false
    );
  });

  test("includes a patient when criteria has no filters at all", () => {
    const encounter: FakeEncounter = {
      riskLevel: "low",
      careSetting: "General Medicine",
      dischargeTimestamp: new Date(now - 1 * 60 * 60 * 1000),
      followUpWindowHours: 72,
    };
    expect(isEligible(encounter, {}, now)).toBe(true);
  });

  test("filters by care setting correctly", () => {
    const encounter: FakeEncounter = {
      riskLevel: "medium",
      careSetting: "Orthopedics",
      dischargeTimestamp: new Date(now - 2 * 60 * 60 * 1000),
      followUpWindowHours: 48,
    };
    expect(isEligible(encounter, { careSettings: ["Cardiology"] }, now)).toBe(false);
    expect(isEligible(encounter, { careSettings: ["Orthopedics"] }, now)).toBe(true);
  });
});