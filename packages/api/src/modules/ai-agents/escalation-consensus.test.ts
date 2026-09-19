/**
 * Unit tests for the escalation consensus decision logic (Section 16, 28).
 * Tests the pure decision rules (agreement/disagreement handling, conservative
 * escalation triggers) without making real AI calls.
 */

const CLASSIFICATION_SEVERITY: Record<string, number> = {
  routine: 0,
  uncertain: 1,
  concerning: 2,
  urgent: 3,
};

interface FakeAssessment {
  classification: "routine" | "concerning" | "urgent" | "uncertain";
  confidence: number;
  escalationRecommended: boolean;
}

function decideConsensus(a: FakeAssessment, b: FakeAssessment) {
  const severities = [a, b].map((x) => CLASSIFICATION_SEVERITY[x.classification]);
  const maxSeverity = Math.max(...severities);
  const agreement = severities[0] === severities[1];
  const anyEscalationRecommended = a.escalationRecommended || b.escalationRecommended;
  const anyLowConfidence = a.confidence < 0.6 || b.confidence < 0.6;

  const finalEscalationDecision =
    anyEscalationRecommended || !agreement || anyLowConfidence || maxSeverity >= 1;

  return { agreement, finalEscalationDecision, maxSeverity };
}

describe("escalation consensus decision logic", () => {
  test("both routine, high confidence, no escalation recommended -> does not escalate", () => {
    const result = decideConsensus(
      { classification: "routine", confidence: 0.9, escalationRecommended: false },
      { classification: "routine", confidence: 0.85, escalationRecommended: false }
    );
    expect(result.finalEscalationDecision).toBe(false);
    expect(result.agreement).toBe(true);
  });

  test("disagreement between assessments always triggers escalation", () => {
    const result = decideConsensus(
      { classification: "routine", confidence: 0.9, escalationRecommended: false },
      { classification: "concerning", confidence: 0.9, escalationRecommended: false }
    );
    expect(result.agreement).toBe(false);
    expect(result.finalEscalationDecision).toBe(true);
  });

  test("both agree routine but one has low confidence -> escalates (conservative)", () => {
    const result = decideConsensus(
      { classification: "routine", confidence: 0.9, escalationRecommended: false },
      { classification: "routine", confidence: 0.4, escalationRecommended: false }
    );
    expect(result.agreement).toBe(true);
    expect(result.finalEscalationDecision).toBe(true);
  });

  test("either assessment recommending escalation forces escalation even if classifications agree as routine", () => {
    const result = decideConsensus(
      { classification: "routine", confidence: 0.9, escalationRecommended: true },
      { classification: "routine", confidence: 0.9, escalationRecommended: false }
    );
    expect(result.finalEscalationDecision).toBe(true);
  });

  test("any non-routine agreed classification (uncertain/concerning/urgent) escalates", () => {
    const uncertain = decideConsensus(
      { classification: "uncertain", confidence: 0.9, escalationRecommended: false },
      { classification: "uncertain", confidence: 0.9, escalationRecommended: false }
    );
    const urgent = decideConsensus(
      { classification: "urgent", confidence: 0.95, escalationRecommended: true },
      { classification: "urgent", confidence: 0.95, escalationRecommended: true }
    );
    expect(uncertain.finalEscalationDecision).toBe(true);
    expect(urgent.finalEscalationDecision).toBe(true);
  });
});