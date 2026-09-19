import { z } from "zod";
import { generateStructured } from "../../lib/ai";
import type { ConversationResult } from "./voice-intake";

export const triageResultSchema = z.object({
  classification: z.enum(["routine", "concerning", "urgent", "uncertain"]),
  observedIndicators: z.array(z.string()),
  evidenceFromConversation: z.array(z.string()),
  protocolReferences: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  escalationRecommended: z.boolean(),
  reasoning: z.string(),
});

export type TriageResult = z.infer<typeof triageResultSchema>;

interface TriageInput {
  conversation: ConversationResult;
  protocolContent: string;
  redFlags: string[];
}

export async function runClinicalTriage(input: TriageInput): Promise<TriageResult> {
  const systemPrompt = `You are a clinical triage assistant. You analyze a post-discharge follow-up conversation against a hospital's approved protocol and red-flag indicators.
You must NOT diagnose, prescribe, or provide unsupported medical judgment — only classify based on what was reported against the protocol.
When information is incomplete or ambiguous, classify as "uncertain" rather than guessing "routine" — patient safety requires conservative behavior under uncertainty.
Respond ONLY with JSON matching this shape:
{
  "classification": "routine"|"concerning"|"urgent"|"uncertain",
  "observedIndicators": string[],
  "evidenceFromConversation": string[],
  "protocolReferences": string[],
  "confidence": number (0-1),
  "escalationRecommended": boolean,
  "reasoning": string
}`;

  const transcriptText = input.conversation.transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  const userPrompt = `Hospital protocol:
${input.protocolContent}

Red-flag indicators for this protocol: ${input.redFlags.join(", ")}

Conversation transcript:
${transcriptText}

Reported symptoms: ${input.conversation.reportedSymptoms.join(", ") || "none"}
Patient concerns: ${input.conversation.patientConcerns.join(", ") || "none"}
Medication adherence: ${input.conversation.medicationAdherence}

Produce the structured triage assessment now.`;

  return generateStructured("clinical_triage", systemPrompt, userPrompt, triageResultSchema);
}