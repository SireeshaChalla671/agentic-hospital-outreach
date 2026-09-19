# Known Limitations and Tradeoffs

This document distinguishes intentional prototype simplifications from
incomplete functionality, per the PRD's request that evaluators be able to
tell the two apart.

## Intentional Simplifications (by design, for a 3-4 day prototype)

- **No real telephony.** Voice interaction is a deterministic AI
  conversation simulation (Gemini generates both sides of a plausible
  conversation given a scenario), not a real phone call via a voice
  provider. The PRD explicitly allows this ("a deterministic call
  simulator is acceptable for demonstrating the core queue and AI
  workflow" — Section 14).
- **Mock EHR, not a real integration.** `EhrSyncRecord` simulates writes to
  an external EHR and can simulate failure (`SIMULATE_EHR_FAILURE=true`),
  but there is no real FHIR/HL7 integration. The interface
  (`ehr.service.ts`) is designed to be swappable for a real implementation
  without changing calling code.
- **Simplified healthcare data model.** `Patient`/`Encounter` capture the
  entities the PRD asks for (conditions, medications, care setting, risk
  level, follow-up window) but are not FHIR-compliant resources. Exact
  FHIR compliance was explicitly not required by the PRD.
- **Protocol retrieval is keyword-based, not semantic/embedding-based.**
  `retrieveRelevantProtocol()` matches on simple keyword overlap between a
  patient's conditions/care setting and each protocol's category. This is
  tenant-safe and functional but would miss more nuanced matches that a
  proper retrieval system (embeddings + vector search) would catch.
- **Escalation "consensus" uses one model, twice.** The two independent
  assessments are both Gemini calls (different prompt framing: standard
  vs. adversarial/red-team), not two architecturally distinct models. A
  stronger production design would use a second, different model provider
  or a deterministic rule-based red-flag checker as a genuinely independent
  second opinion.
- **In-memory AI usage logging.** `aiUsageLog` in `lib/ai.ts` is a
  process-memory array (capped at 500 entries), not persisted to the
  database. It resets on server restart. Sufficient to demonstrate the
  observability pattern; a production system would persist this.
- **No background worker/cron process.** Queue claiming
  (`/queue/:hospitalId/claim`), priority recomputation, and stale-lock
  recovery (`/queue/recover-stale`) are implemented as callable endpoints,
  demonstrated via the manual test flow and `queue-simulation.ts`, rather
  than wired to an actual scheduled background process (e.g. a cron job or
  persistent worker loop). The underlying logic is production-shaped
  (atomic `SKIP LOCKED` reservation, idempotent outcome recording) and
  would just need a scheduler wrapped around it.
- **Notifications are logged, not delivered.** The PRD allows "an internal
  dashboard, email, SMS, or another configurable mechanism" for
  notifications; this prototype does not implement actual email/SMS
  delivery — escalation and audit records serve as the observable trail
  instead.
- **Simplified consent/communication-preference model.** Patient
  `preferredContactTime` is captured but not deeply integrated into
  eligibility/scheduling decisions beyond what's described; a production
  system would enforce consent status more rigorously before any outreach.

## Free-Tier API Constraints (operational, not architectural)

- The Gemini free tier enforces per-minute rate limits (as low as
  15 requests/minute on `gemini-3.5-flash-lite`, and as low as 20/day on
  the newest flagship model at time of writing). The safety evaluation
  script paces requests (~8s between cases) to stay under this limit. A
  paid tier or a different provider would remove this constraint entirely
  — it does not reflect a limitation of the system's design.

## What Would Need to Change for Real Patient Data / Production Use

Per Section 25's explicit request to document this:

1. **Real EHR integration** (FHIR/HL7 API) replacing the mock service,
   with proper OAuth2/SMART-on-FHIR authentication.
2. **Actual telephony provider** (e.g. Twilio, Vonage) with real-time
   speech-to-text/text-to-speech, replacing the conversation simulator.
3. **HIPAA compliance work**: encryption at rest for PHI fields, a signed
   Business Associate Agreement with any AI provider used, formal audit
   log retention policy, access logging on every read (not just writes),
   and a real secrets-management system (not `.env` files).
4. **A genuinely independent second model/assessment path** for escalation
   consensus, ideally from a different provider, to avoid correlated
   failure modes between the two assessments.
5. **A much larger, clinician-reviewed safety evaluation dataset** with
   statistically meaningful sample sizes per category, run continuously
   in CI against any prompt/model change.
6. **A real background worker/scheduler** (not manually-triggered
   endpoints) with proper observability (metrics, alerting) around queue
   health, stuck-task detection, and AI failure rates.
7. **Persisted AI usage/cost tracking** rather than in-memory logging.
8. **Formal consent management** integrated into eligibility, with an
   auditable record of patient communication consent per channel.
9. **Load testing** at the hundreds-of-thousands-of-patients scale the PRD
   describes as a future target, including database indexing review and
   read-replica strategy for dashboard queries.

No claim of HIPAA, SOC 2, or other certification is made or implied by
this prototype.