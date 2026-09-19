# Development AI Usage

## Overview

This project was built collaboratively with Claude (Anthropic), used as a
pair-programming and system-design assistant throughout the full
development process, from architecture through implementation, debugging,
and documentation.

## How AI Assistance Was Used, By Phase

### Architecture & Planning
- Broke down the PRD into a prioritized build sequence (schema first, then
  auth, then core CRUD modules, then the queue engine, then AI agents,
  then human-in-the-loop workflows, then dashboards/frontend/docs),
  explicitly sequenced to front-load the highest-graded, highest-risk
  components (queue concurrency, AI safety consensus) rather than starting
  with UI.
- Designed the Prisma data model in one pass, covering all PRD-required
  entities (Hospital, User, Patient, Encounter, Protocol, Campaign,
  OutreachTask, Call, Escalation, AuditLog, EhrSyncRecord) with explicit
  tenant-scoping (`hospitalId`) on every relevant table.

### Database & Backend Setup
- Diagnosed and resolved a genuinely non-obvious environment issue: a
  native Windows PostgreSQL service silently intercepting connections
  intended for the Docker Postgres container on the same default port
  (5432), traced via `netstat`/`tasklist` and resolved by remapping the
  container to port 5433.
- Diagnosed a Prisma CLI version issue (an early `npm install prisma`
  pulled a v8 release-candidate with an incompatible, restructured CLI)
  and guided a downgrade to stable Prisma 6.

### Queue Engine
- Designed the priority-scoring formula and the `SKIP LOCKED`-based atomic
  reservation SQL, explained the concurrency-safety reasoning inline, and
  the resulting design was verified live: with `outboundCapacity=14` and
  18 eligible tasks, exactly 14 were claimed by a single reservation call,
  proving no over-allocation.
- Designed retry/backoff, callback handling, and stale-lock crash recovery
  logic together as one cohesive queue service module.

### AI Agent Pipeline
- Designed the 4-agent separation (Voice Intake, Clinical Triage,
  Escalation Consensus, Documentation) with Zod-validated structured
  output contracts for each.
- Designed the escalation consensus mechanism (two independently-framed
  triage calls, conservative disagreement handling).
- Diagnosed and fixed two live model-availability issues during
  development (`gemini-2.0-flash` and later `gemini-2.5-flash-lite` were
  deprecated mid-project by the provider) by inspecting the actual
  available-models list via the API and selecting a working replacement
  (`gemini-3.5-flash-lite`).
- Diagnosed a free-tier rate-limiting issue (429 errors) during the first
  full safety-evaluation run, and implemented rate-limit-aware retry
  (parsing the provider's suggested `retryDelay`) plus inter-case pacing
  in the evaluation script, after which the full 20-case suite completed
  successfully.

### Safety Evaluation
- Authored the fixed 20-case safety evaluation dataset spanning all 7
  PRD-required categories (routine, concerning, urgent, ambiguous,
  incomplete information, conflicting information, adversarial), each
  with a deliberately chosen expected outcome.
- Designed the TP/FP/TN/FN classification and false-negative-rate
  reporting logic.

### Escalation Workflow, Mock EHR, Dashboards
- Designed the escalation state machine (OPEN → ASSIGNED → IN_REVIEW →
  RESOLVED → CLOSED) and its API surface.
- Designed the mock EHR abstraction (`ehr.service.ts`) with explicit
  success/failure logging via `EhrSyncRecord`, and wired automatic
  EHR write-back into the call-conduct pipeline.
- Designed the three role-scoped dashboard aggregation endpoints
  (Campaign, Hospital, Platform) and the analytics endpoint.

### Frontend
- Scaffolded a minimal React + Vite + React Router frontend (Login,
  Dashboard, Campaigns, Queue, Escalations pages) consuming the backend
  API directly, styled with plain CSS (no component library) to keep
  build time low while remaining demo-presentable.
- Diagnosed a dependency-installation-order issue (a Vite pre-transform
  error for `axios`/`react-router-dom`) traced to packages not finishing
  installation before the dev server was started.

### Documentation
- All 9 required written deliverables (this document included) were
  drafted based on the actual, tested implementation — architecture,
  queue design, safety evaluation report, AI usage documentation, known
  limitations, and this development-AI-usage summary — rather than
  generic boilerplate, referencing real file paths, real measured results
  (e.g. the 0% false-negative rate from the actual evaluation run), and
  real PRD section numbers throughout.

## Verification Approach

Every major component was tested against live data before being
considered complete, not just written and assumed correct: real HTTP
requests against the running server for auth/hospitals/patients/
campaigns/queue/calls/escalations/EHR/dashboards, a live 25-patient queue
simulation, and a live 20-case safety evaluation — all captured in this
conversation's history as the basis for the documentation above.