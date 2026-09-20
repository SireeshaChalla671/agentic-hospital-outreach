## Demo Video

Watch the full walkthrough here: https://youtu.be/7M3FpLv4X6k?si=3Bs6RoyaKjS9-gOg
## Live Deployment

- **Frontend:** https://agentic-hospital-outreach.vercel.app/
- **Backend API:** https://agentic-hospital-outreach-production.up.railway.app
- **Health check:** https://agentic-hospital-outreach-production.up.railway.app/health

### Demo Credentials

| Role | Email | Password |
|---|---|---|
| Platform Admin | admin@platform.com | password123 |
| Hospital Admin (General City) | hospitaladmin@general.city.hospital.com | password123 |
| Campaign Manager (General City) | campaignmanager@general.city.hospital.com | password123 |
| Clinical Reviewer (General City) | reviewer@general.city.hospital.com | password123 |

# Multi-Hospital Post-Discharge Outreach Platform

An AI-powered, multi-tenant healthcare operations platform for automating
post-discharge patient follow-up, clinical triage, and human escalation
across multiple hospitals.

Built as a 3-4 day full-stack AI engineering prototype. See `docs/` for
full architecture, queue design, safety evaluation, and AI usage
documentation.

## What This Is

Hospitals import discharge patients, create outreach campaigns, and the
platform's capacity-aware queue schedules AI-conducted follow-up calls,
runs clinical triage against hospital protocols, and escalates concerning
cases to human reviewers — all with full tenant isolation, audit logging,
and a reproducible safety evaluation suite (0% false-negative rate on the
20-case fixed dataset — see `docs/safety-eval-report.md`).

## Tech Stack

- **Backend:** Node.js, TypeScript, Express
- **Database:** PostgreSQL (via Docker), Prisma ORM
- **AI:** Google Gemini (`gemini-3.5-flash-lite`), via a provider-agnostic
  `generateStructured()` abstraction
- **Frontend:** React, Vite, React Router
- **Auth:** JWT + bcrypt, role-based access control (4 roles)

## Project Structure
agentic_hospital/
├── docker-compose.yml # Postgres container
├── packages/
│ ├── api/ # Express backend
│ │ ├── prisma/ # Schema + migrations + seed script
│ │ └── src/
│ │ ├── modules/ # auth, hospitals, patients, campaigns,
│ │ │ # queue, ai-agents, calls, escalations,
│ │ │ # ehr, dashboards
│ │ ├── middleware/ # auth, RBAC, tenant isolation
│ │ ├── lib/ # prisma client, AI abstraction
│ │ └── scripts/ # safety-eval.ts
│ └── web/ # React frontend
├── simulation/
│ └── queue-simulation.ts # required 25-patient queue simulation
└── docs/ # all required written deliverables

## Setup

### Prerequisites
- Node.js 18+
- Docker Desktop

### 1. Start the database

```bash
docker compose up -d
```

### 2. Configure environment

Copy `packages/api/.env.example` to `packages/api/.env` and fill in:
DATABASE_URL="postgresql://hospital_admin:hospital_pass@localhost:5433/hospital_platform"
PORT=4000
JWT_SECRET="your_secret_here"
GEMINI_API_KEY="your_gemini_api_key"

### 3. Install dependencies and set up the database

```bash
cd packages/api
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

This creates 3 hospitals, role-based users for each (password:
`password123`), hospital protocols, and 350 simulated patients.

### 4. Start the backend

```bash
npm run dev
```

Runs at `http://localhost:4000`.

### 5. Start the frontend

```bash
cd packages/web
npm install
npm run dev
```

Runs at `http://localhost:5173`.

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Platform Admin | admin@platform.com | password123 |
| Hospital Admin | hospitaladmin@general.city.hospital.com | password123 |
| Campaign Manager | campaignmanager@general.city.hospital.com | password123 |
| Clinical Reviewer | reviewer@general.city.hospital.com | password123 |

## Running the Required Queue Simulation

```bash
cd packages/api
node -r ts-node/register ../../simulation/queue-simulation.ts
```

Creates a dedicated low-capacity hospital, seeds 25 mock patients with
mixed risk/deadlines, and runs the real queue engine through multiple
claim/outcome rounds, printing state changes live.

## Running the Safety Evaluation

```bash
cd packages/api
node -r ts-node/register src/scripts/safety-eval.ts
```

Runs the fixed 20-case dataset against the live AI pipeline and writes a
report to `docs/safety-eval-latest.json`. See `docs/safety-eval-report.md`
for the narrative writeup of the most recent run.

## Key Design Documents

- [`docs/architecture.md`](docs/architecture.md) — system architecture and boundaries
- [`docs/queue-design.md`](docs/queue-design.md) — queue state machine, priority algorithm, concurrency control
- [`docs/safety-eval-report.md`](docs/safety-eval-report.md) — safety evaluation results
- [`docs/ai-usage.md`](docs/ai-usage.md) — AI provider, models, prompts, tools
- [`docs/known-limitations.md`](docs/known-limitations.md) — intentional tradeoffs vs. what's needed for production
- [`docs/dev-ai-usage.md`](docs/dev-ai-usage.md) — how AI assisted in building this project

## Known Limitations

See `docs/known-limitations.md` for the full list. Headline items: no real
telephony (deterministic conversation simulation instead, per spec
allowance), mock EHR rather than a live integration, and the two
"independent" triage assessments currently share one underlying model
(documented as a limitation, not a hidden shortcut).