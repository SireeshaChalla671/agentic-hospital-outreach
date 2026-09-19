import { prisma } from "../../lib/prisma";

// Simple keyword-based protocol matching: looks at the patient's conditions
// and care setting, matches against protocol category. Tenant-aware by construction
// since we always filter by hospitalId — a patient from Hospital A can never
// retrieve Hospital B's protocol (Section 7 requirement).
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  cardiac: ["cardiac", "heart", "hypertension", "cardiology"],
  "post-surgical": ["surgery", "surgical", "wound", "orthopedic", "replacement"],
  diabetes: ["diabetes", "diabetic", "insulin", "blood sugar"],
  respiratory: ["copd", "pneumonia", "asthma", "pulmonology", "respiratory"],
};

export async function retrieveRelevantProtocol(hospitalId: string, conditions: string[], careSetting: string) {
  const protocols = await prisma.protocol.findMany({ where: { hospitalId } });
  if (protocols.length === 0) return null;

  const searchText = [...conditions, careSetting].join(" ").toLowerCase();

  for (const protocol of protocols) {
    const keywords = CATEGORY_KEYWORDS[protocol.category] || [];
    if (keywords.some((kw) => searchText.includes(kw))) {
      return protocol;
    }
  }

  // Fallback: no specific match, return the first protocol so the AI still has
  // some grounding rather than none (documented as a known limitation).
  return protocols[0];
}