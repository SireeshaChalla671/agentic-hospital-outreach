import { z } from "zod";
import { generateStructured } from "../../lib/ai";
import type { ConversationResult } from "./voice-intake";
import type { ConsensusResult } from "./escalation-consensus";

const documentationSchema = z.object({
  summary: z.string(),
});

interface DocumentationInput {
  patientFirstName: string;
  conversation: ConversationResult;
  consensus: ConsensusResult;
}

export async function generateDocumentation(input: DocumentationInput): Promise<string> {
  const systemPrompt = `You are a clinical documentation assistant. Convert a post-discharge follow-up call into a concise, factual clinical note.
Do not add clinical judgment beyond what was assessed. State facts, reported symptoms, the triage outcome, and any escalation status plainly.
Respond ONLY with JSON: {"summary": string}`;

  const transcriptText = input.conversation.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n");

  const userPrompt = `Patient: ${input.patientFirstName}
Call outcome: ${input.conversation.callOutcome}
Reported symptoms: ${input.conversation.reportedSymptoms.join(", ") || "none"}
Medication adherence: ${input.conversation.medicationAdherence}
Triage classification: ${input.consensus.finalClassification}
Escalation decision: ${input.consensus.finalEscalationDecision ? "ESCALATED" : "not escalated"}
Consensus reasoning: ${input.consensus.consensusReasoning}

Transcript:
${transcriptText}

Write a concise clinical documentation summary (3-5 sentences) now.`;

  const result = await generateStructured("documentation", systemPrompt, userPrompt, documentationSchema);
  return result.summary;
}