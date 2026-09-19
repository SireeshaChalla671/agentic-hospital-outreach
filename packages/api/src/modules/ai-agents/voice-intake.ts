import { z } from "zod";
import { generateStructured } from "../../lib/ai";

const conversationSchema = z.object({
  transcript: z.array(
    z.object({
      speaker: z.enum(["agent", "patient"]),
      text: z.string(),
    })
  ),
  reportedSymptoms: z.array(z.string()),
  patientConcerns: z.array(z.string()),
  medicationAdherence: z.enum(["adherent", "partial", "non-adherent", "unknown"]),
  callOutcome: z.enum(["completed", "patient_declined", "unable_to_assess"]),
});

export type ConversationResult = z.infer<typeof conversationSchema>;

export interface PriorCallSummary {
  date: string;
  outcome: string;
  reportedSymptoms: string[];
  documentation: string | null;
}

interface VoiceIntakeInput {
  patientFirstName: string;
  conditions: string[];
  medications: string[];
  careSetting: string;
  riskLevel: string;
  protocolContent: string;
  protocolQuestions?: string;
  simulatedScenario?: string;
  priorCalls?: PriorCallSummary[];
}

export async function runVoiceIntake(input: VoiceIntakeInput): Promise<ConversationResult> {
  const systemPrompt = `You are simulating a realistic post-discharge follow-up phone conversation between a hospital outreach agent and a patient.
You must ONLY ask questions grounded in the provided hospital protocol. Do not invent medical advice or diagnoses.
If prior call history is provided, do not re-ask questions already answered; instead, follow up on previously reported symptoms/concerns to check whether they have changed.
Produce a natural but concise conversation (6-12 turns total) covering the protocol's key questions.
Respond ONLY with JSON matching this shape:
{
  "transcript": [{"speaker": "agent"|"patient", "text": string}, ...],
  "reportedSymptoms": string[],
  "patientConcerns": string[],
  "medicationAdherence": "adherent"|"partial"|"non-adherent"|"unknown",
  "callOutcome": "completed"|"patient_declined"|"unable_to_assess"
}`;

  const priorCallsText =
    input.priorCalls && input.priorCalls.length > 0
      ? `\nPrior outreach history for this patient (most recent first):\n${input.priorCalls
          .map(
            (c, i) =>
              `  ${i + 1}. ${c.date} - outcome: ${c.outcome} - reported: ${
                c.reportedSymptoms.join(", ") || "none"
              }${c.documentation ? ` - note: ${c.documentation}` : ""}`
          )
          .join("\n")}\nThe agent should reference this history naturally (e.g. "last time you mentioned X, how is that now?") rather than starting from zero.`
      : "\nNo prior outreach history for this patient -- this is the first contact.";

  const userPrompt = `Patient: ${input.patientFirstName}
Care setting: ${input.careSetting}
Known conditions: ${input.conditions.join(", ") || "none recorded"}
Medications: ${input.medications.join(", ") || "none recorded"}
Discharge risk level: ${input.riskLevel}
${priorCallsText}

Hospital protocol to follow:
${input.protocolContent}
${input.protocolQuestions ? `Specific questions to ask: ${input.protocolQuestions}` : ""}

${input.simulatedScenario ? `Scenario to simulate for this patient's responses: ${input.simulatedScenario}` : "Simulate a plausible, varied patient response consistent with their risk level."}

Generate the full simulated conversation now.`;

  return generateStructured("voice_intake", systemPrompt, userPrompt, conversationSchema);
}