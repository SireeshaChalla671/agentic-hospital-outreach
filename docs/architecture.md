# Architecture Documentation

## Multi-Hospital Post-Discharge Outreach Platform

## 1. Overview

This system is a multi-tenant healthcare operations platform that automates
post-discharge patient follow-up across multiple hospitals. It is built as a
single Node.js/TypeScript backend (Express + Prisma + PostgreSQL) with a
React frontend, and integrates a Gemini-based multi-agent AI pipeline for
conversation simulation, clinical triage, escalation consensus, and
documentation.

## 2. High-Level Architecture
┌─────────────────┐
│ React Frontend │ (Vite + React Router)
│ Dashboards, Queue│
│ Escalation Review│
└────────┬─────────┘
│ REST (JWT auth)
┌────────▼─────────────────────────────────────────────────┐
│ Express API Server │
│ │
│ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐ │
│ │ Auth │ │ Hospitals │ │ Patients │ │ Campaigns │ │
│ │ (JWT/ │ │ + RBAC │ │+Encounter│ │ +Eligibility │ │
│ │ bcrypt) │ │ │ │ │ │ │ │
│ └──────────┘ └───────────┘ └──────────┘ └──────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ QUEUE ENGINE (core concurrency) │ │
│ │ Priority scoring | SKIP LOCKED reservation | │ │
│ │ Retry/backoff | Callback handling | Crash recovery │ │
│ └──────────────────────────────────────────────────────┘ │
│ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ AI AGENT PIPELINE │ │
│ │ Voice Intake → Escalation Consensus (2x Triage) → │ │
│ │ Documentation │ │
│ │ (controlled tool pattern: AI never writes directly) │ │
│ └──────────────────────────────────────────────────────┘ │
│ │
│ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐ │
│ │Escalations│ │ Mock EHR │ │Dashboards│ │ Audit Log │ │
│ │(human loop│ │(read/write│ │/Analytics│ │ │ │
│ │workflow) │ │abstraction│ │ │ │ │ │
│ └──────────┘ └───────────┘ └──────────┘ └──────────────┘ │
└────────┬─────────────────────────────────────────────────┘
│
┌────────▼─────────┐ ┌────────────────────┐
│ PostgreSQL │ │ Gemini API │
│ (Docker container) │ │ (gemini-3.5-flash- │
│ All tenant data, │ │ lite) │
│ queue state, audit │ │ Structured JSON │
└───────────────────┘ │ output + validation │
└────────────────────┘
## 3. Major Responsibilities & Boundaries

| Layer | Responsibility |
|---|---|
| **Auth/RBAC middleware** | JWT verification, role checks, tenant-match enforcement on every protected route |
| **Hospital/Patient/Campaign modules** | CRUD + business rules for tenant-scoped entities |
| **Queue Engine** (`modules/queue`) | The system's core concurrency boundary — all capacity, priority, retry, and crash-recovery logic lives here, isolated from HTTP concerns |
| **AI Agents** (`modules/ai-agents`) | Four independent agent functions, each with a narrow responsibility and a Zod-validated output contract. Agents never touch the database directly |
| **Calls orchestration** (`modules/calls`) | The controlled tool boundary: receives AI agent outputs, validates them, and is the only layer permitted to write `Call`/`Escalation`/`EhrSyncRecord` rows |
| **Escalations module** | Human-in-the-loop state machine (OPEN → ASSIGNED → IN_REVIEW → RESOLVED → CLOSED) |
| **Mock EHR** (`modules/ehr`) | Replaceable read/write abstraction; all writes logged to `EhrSyncRecord` for observability regardless of success/failure |
| **Dashboards** | Read-only aggregation endpoints per role (Campaign Manager, Hospital Admin, Platform Admin) |

## 4. Tenant Isolation

Every tenant-scoped table (`Patient`, `Campaign`, `Protocol`, `Escalation`,
`AuditLog`, `EhrSyncRecord`, etc.) carries an explicit `hospitalId` foreign
key. Isolation is enforced at the **application/query layer**, not the
frontend:

- Every route handler that isn't `PLATFORM_ADMIN`-only compares
  `req.user.hospitalId` against the resource's `hospitalId` before returning
  or mutating data, returning `403 Cross-tenant access denied` on mismatch.
- List endpoints filter `WHERE hospitalId = ...` at the Prisma query level —
  a hospital's data is never fetched and then filtered client-side.
- AI protocol retrieval (`retrieveRelevantProtocol`) always scopes its
  `Protocol` query by `hospitalId`, so a patient from Hospital A can never
  cause retrieval of Hospital B's clinical protocol.
- Background/queue operations (`reserveTasks`, `recomputeAllPriorities`)
  take an explicit `hospitalId` parameter and join through `Campaign` to
  enforce the same boundary in raw SQL.

## 5. AI Agent Architecture

Four distinct agents, each a separate module with its own prompt and Zod
schema (Section 13 requirement — not one unrestricted agent):

1. **Voice Intake Agent** — simulates the patient conversation, grounded in
   the hospital's retrieved protocol. Produces a structured transcript,
   reported symptoms, and medication adherence status.
2. **Clinical Triage Agent** — converts a conversation into a structured
   assessment (classification, evidence, protocol references, confidence).
3. **Escalation Consensus** — runs the Triage Agent **twice** with different
   framings (standard vs. adversarial/red-team) and compares results.
   Disagreement or any non-routine/low-confidence signal triggers
   conservative escalation.
4. **Documentation Agent** — converts the conversation + consensus result
   into a factual clinical summary, with no added clinical judgment.

**Controlled tool pattern**: AI agents return structured data only. The
`calls.routes.ts` orchestration layer is the sole code path permitted to
persist `Call`, `Escalation`, or `EhrSyncRecord` rows — validated via Zod
before any write, exactly matching the PRD's
`AI request → authorization → schema validation → business rules → execution → audit`
pattern.

## 6. Data Model

See `packages/api/prisma/schema.prisma` for the full model. Key
relationships: `Hospital` → `User`/`Patient`/`Campaign`/`Protocol` →
`Encounter`, `OutreachTask` (the queue) → `Call` → `Escalation`. Every
write-path table carries `createdAt`/`updatedAt` for history, and
`AuditLog`/`EhrSyncRecord` provide a durable, append-only trail of
system and AI actions.

## 7. Known Architectural Simplifications

See `docs/known-limitations.md` for the full list. Most significant: no
real telephony (deterministic AI conversation simulation instead, per
PRD Section 14's explicit allowance); mock EHR rather than a real
integration; in-memory AI usage logging (would be persisted in
production); single AI provider (Gemini) behind an abstraction that
could be swapped.