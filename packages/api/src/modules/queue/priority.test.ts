/**
 * Unit tests for the queue priority scoring algorithm (Section 10, 28).
 * Mirrors the pure scoring logic from priority.ts so it can be tested
 * without a database connection.
 */

const RISK_WEIGHT: Record<string, number> = { high: 30, medium: 15, low: 5 };

function deadlineUrgencyScore(hoursRemaining: number): number {
  if (hoursRemaining <= 0) return 40;
  if (hoursRemaining <= 2) return 38;
  if (hoursRemaining <= 6) return 32;
  if (hoursRemaining <= 12) return 24;
  if (hoursRemaining <= 24) return 15;
  if (hoursRemaining <= 48) return 8;
  return 3;
}

function retryPenalty(attemptCount: number): number {
  return Math.min(attemptCount * 4, 15);
}

function computeScore(params: {
  riskLevel: string;
  hoursRemaining: number;
  campaignPriority: number;
  attemptCount: number;
  callbackDue: boolean;
}): number {
  let score = 0;
  score += RISK_WEIGHT[params.riskLevel] ?? 5;
  score += deadlineUrgencyScore(params.hoursRemaining);
  score += params.campaignPriority * 2;
  score -= retryPenalty(params.attemptCount);
  if (params.callbackDue) score += 25;
  return Math.round(score * 100) / 100;
}

describe("queue priority scoring", () => {
  test("high risk scores higher than low risk, all else equal", () => {
    const high = computeScore({ riskLevel: "high", hoursRemaining: 24, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    const low = computeScore({ riskLevel: "low", hoursRemaining: 24, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    expect(high).toBeGreaterThan(low);
  });

  test("imminent deadline outranks distant deadline even with lower risk", () => {
    const nearDeadlineLowRisk = computeScore({ riskLevel: "low", hoursRemaining: 1, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    const farDeadlineHighRisk = computeScore({ riskLevel: "high", hoursRemaining: 60, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    // 1h remaining: 5 (low) + 38 (urgency) + 10 (priority) = 53
    // 60h remaining: 30 (high) + 3 (urgency) + 10 (priority) = 43
    expect(nearDeadlineLowRisk).toBeGreaterThan(farDeadlineHighRisk);
  });

  test("retry penalty reduces score but is capped at 15", () => {
    const zeroAttempts = computeScore({ riskLevel: "medium", hoursRemaining: 24, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    const manyAttempts = computeScore({ riskLevel: "medium", hoursRemaining: 24, campaignPriority: 5, attemptCount: 10, callbackDue: false });
    expect(zeroAttempts - manyAttempts).toBe(15); // capped, not 40
  });

  test("retry penalty never fully cancels out a high-risk near-deadline score", () => {
    const heavilyRetried = computeScore({ riskLevel: "high", hoursRemaining: 1, campaignPriority: 5, attemptCount: 20, callbackDue: false });
    // 30 (high) + 38 (urgency) + 10 (priority) - 15 (capped penalty) = 63, still well above zero
    expect(heavilyRetried).toBeGreaterThan(40);
  });

  test("callback bonus boosts a due callback above a routine pending task", () => {
    const dueCallback = computeScore({ riskLevel: "low", hoursRemaining: 48, campaignPriority: 5, attemptCount: 1, callbackDue: true });
    const routinePending = computeScore({ riskLevel: "medium", hoursRemaining: 48, campaignPriority: 5, attemptCount: 0, callbackDue: false });
    expect(dueCallback).toBeGreaterThan(routinePending);
  });

  test("campaign priority contributes but cannot override an imminent deadline", () => {
    const lowPriorityCampaignNearDeadline = computeScore({ riskLevel: "medium", hoursRemaining: 1, campaignPriority: 1, attemptCount: 0, callbackDue: false });
    const maxPriorityCampaignFarDeadline = computeScore({ riskLevel: "medium", hoursRemaining: 72, campaignPriority: 10, attemptCount: 0, callbackDue: false });
    // near-deadline: 15 + 38 + 2 = 55; far-deadline max-priority: 15 + 3 + 20 = 38
    expect(lowPriorityCampaignNearDeadline).toBeGreaterThan(maxPriorityCampaignFarDeadline);
  });
});