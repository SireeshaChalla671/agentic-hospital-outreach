# AI Usage Documentation

## 1. Provider and Model Selection

**Provider:** Google Gemini API (`@google/generative-ai` SDK)
**Model:** `gemini-3.5-flash-lite`

The system is not hard-coded to a single provider's SDK shape at the
business-logic layer: all AI calls flow through one function,
`generateStructured()` in `src/lib/ai.ts`, which every agent module calls
with a purpose label, system prompt, user prompt, and a Zod schema. Swapping
providers means reimplementing this one function (e.g. against the
Anthropic or OpenAI SDK) — no agent module or route handler would need to
change, satisfying the PRD's requirement (Section 27) to avoid unnecessary
coupling to a single AI provider.

**Why Gemini / this specific model:** Gemini was selected primarily for
free-tier API access during prototype development. Within the Gemini family,
`gemini-3.5-flash-lite` was selected after two other models
(`gemini-3.6-flash`, then `gemini-3.5-flash`) were found to have
free-tier quotas too restrictive for iterative development and the
20-case safety evaluation (as low as 20 requests/day on the flagship
model). The `flash-lite` tier offers a substantially higher free-tier
rate limit (15 requests/minute) while remaining capable enough for
structured classification and conversation-simulation tasks. This is
documented as a real engineering tradeoff: a production deployment would
very likely use a higher-capability model (e.g. a Pro-tier model) for the
Clinical Triage and Escalation Consensus agents specifically, given their
safety-criticality, while a lighter model may remain acceptable for Voice
Intake simulation and Documentation.

## 2. Agents, Purposes, and Prompts

| Agent | Purpose label | Input | Output schema |
|---|---|---|---|
| Voice Intake | `voice_intake` | Patient demographics, conditions, medications, hospital protocol text | `{transcript, reportedSymptoms, patientConcerns, medicationAdherence, callOutcome}` |
| Clinical Triage | `clinical_triage` | Conversation transcript, protocol content, red flags | `{classification, observedIndicators, evidenceFromConversation, protocolReferences, confidence, escalationRecommended, reasoning}` |
| Escalation Consensus | (orchestrates 2x `clinical_triage` calls) | Same as above, run twice with different framing | `{assessments[], agreement, disagreementDetails, finalClassification, finalEscalationDecision, consensusReasoning}` |
| Documentation | `documentation` | Conversation + consensus result | `{summary}` (clinical note text) |

Each agent has a single, narrow responsibility (Section 13) and its own
system prompt defining scope and constraints — e.g. the Clinical Triage
prompt explicitly instructs: *"You must NOT diagnose, prescribe, or provide
unsupported medical judgment — only classify based on what was reported
against the protocol... classify as 'uncertain' rather than guessing
'routine'"* — directly encoding the PRD's conservative-under-uncertainty
principle into the prompt itself, not just downstream logic.

## 3. Structured Output & Validation

Every agent call requests `responseMimeType: "application/json"` from the
Gemini API and validates the response against a Zod schema before it is
ever used. If parsing or schema validation fails, `generateStructured()`
performs **one controlled repair retry**, re-sending the prompt with the
validation error appended and an explicit instruction to return only valid
JSON. If the repair also fails, the function throws — the caller
(`calls.routes.ts`) catches this, records the outreach task outcome as
`FAILED`, and returns an explicit `502` error rather than silently
accepting malformed data (Section 15/24).

## 4. Rate-Limit Handling

Separately from output-validation retries, `generateStructured()` detects
`429 Too Many Requests` responses, parses the server-suggested
`retryDelay` from the error payload, and retries (up to 3 times) after
waiting that exact duration. This was necessary in practice — free-tier
Gemini quotas are enforced per-minute — and is logged distinctly from
output-validation failures in the AI usage log.

## 5. Consensus Mechanism

See `queue-design.md`/architecture doc for full detail. Summary: two
independent Clinical Triage calls are made per case — one with the
standard protocol prompt, one with an added adversarial framing
instructing the model to specifically look for reasons a cautious
clinician would escalate. Their classifications are compared; any
disagreement, any individual "escalate" recommendation, any confidence
below 0.6, or any non-routine classification from either assessment
triggers escalation. This is a rule-assisted consensus mechanism (one of
the PRD's explicitly allowed approaches) rather than a black-box vote.

## 6. Tools / Controlled Actions

AI agents never call database or EHR write functions directly. The
pattern (Section 18) is:

No agent has a "tool" that can directly mutate `Escalation` or `Campaign`
status, override RBAC, or bypass tenant scoping — those checks happen in
the orchestration layer using the authenticated request's hospital
context, not anything the AI outputs.

## 7. Retrieval (Protocol Grounding)

`retrieveRelevantProtocol()` performs simple, tenant-scoped keyword
matching between a patient's conditions/care setting and each hospital's
`Protocol.category`, returning the single most relevant protocol rather
than loading a patient's full history or every hospital document into the
prompt (Section 7's requirement to retrieve only task-necessary context).
This is a known simplification — see `known-limitations.md` — a production
system would likely use embedding-based semantic retrieval for more
nuanced matching.

## 8. Observability

Every `generateStructured()` call logs to an in-memory `aiUsageLog`:
purpose, model, latency, success/failure, and error text on failure. This
feeds the Platform Admin dashboard's AI usage panel (recent failure count,
average latency). In-memory storage is a known prototype simplification —
production would persist this to a queryable store.

## 9. Evaluation

See `safety-eval-report.md` for the full evaluation process and results.
The evaluation script itself (`src/scripts/safety-eval.ts`) is the
canonical, reproducible way to test any future change to prompts, models,
retrieval, or consensus logic against the fixed 20-case dataset.