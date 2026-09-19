# Queue Design Document

## Outbound Capacity-Constrained Queue

## 1. Purpose

This document explains the design and justification of the outbound calling
queue: how tasks are prioritized, how concurrency/capacity is safely
enforced under simultaneous workers, how retries and callbacks are handled,
how clinical deadlines influence scheduling, how fairness/starvation is
prevented, and how the system recovers from worker failure.

## 2. State Machine

Each patient's outreach attempt is tracked as an `OutreachTask` with one of
the following statuses:

`RETRY_SCHEDULED` and `CALLBACK_SCHEDULED` tasks re-enter the eligible pool
once their `scheduledFor` timestamp has passed, and are re-scored and
re-prioritized alongside fresh `PENDING` tasks.

## 3. Priority Calculation

Priority is a **weighted additive score**, not a single "priority" label.
Implemented in `modules/queue/priority.ts`:

**Why these components:**

- **Risk weight** reflects clinical acuity at discharge — a high-risk
  cardiac patient should generally be reached before a low-risk one, all
  else equal.
- **Deadline urgency** is a non-linear step function (3 points at >48h
  remaining, up to 40 points at ≤2h or past-deadline). This is deliberately
  steep near the deadline so that a lower-risk patient about to miss their
  clinical follow-up window can still outrank a higher-risk patient with
  many hours left — directly satisfying the PRD's requirement that
  "a patient who has a high-priority campaign but many hours remaining may
  reasonably be scheduled after a patient whose clinical follow-up window
  is about to expire."
- **Campaign priority** lets a Campaign Manager express that one campaign
  (e.g. "high-risk cardiac readmission") should generally be worked ahead
  of another, without letting it completely override deadline pressure
  (campaign priority contributes at most 20 points vs. up to 40 for an
  imminent deadline).
- **Retry penalty** (capped at -15, so it can never fully cancel out risk
  or deadline urgency) slightly deprioritizes repeatedly-unreachable
  patients, so the queue doesn't keep re-dialing someone who never answers
  ahead of patients who haven't been tried yet — while the cap ensures a
  high-risk, near-deadline patient is never permanently buried just because
  earlier attempts failed.
- **Callback bonus** (+25) ensures a patient who explicitly requested a
  callback at a specific time is prioritized once that time arrives, rather
  than competing purely on risk/deadline against the general pool.

Scores are recomputed on demand (`POST /queue/:hospitalId/recompute`) before
each claim cycle, so ordering always reflects current deadline pressure
rather than a stale score computed at task-creation time.

## 4. Concurrency Control (Capacity Safety)

The single hardest correctness requirement: **N workers must never claim
more than `hospital.outboundCapacity` tasks concurrently, and must never
double-claim the same task.**

Implemented via one atomic SQL statement in `queue.service.ts`:

```sql
WITH selected AS (
  SELECT ot.id FROM "OutreachTask" ot
  JOIN "Campaign" c ON ot."campaignId" = c.id
  WHERE c."hospitalId" = $1 AND c.status = 'RUNNING'
    AND ot.status IN ('PENDING','RETRY_SCHEDULED','CALLBACK_SCHEDULED')
    AND (ot."scheduledFor" IS NULL OR ot."scheduledFor" <= NOW())
  ORDER BY ot."priorityScore" DESC
  LIMIT $2   -- (hospital.outboundCapacity - currently active calls)
  FOR UPDATE OF ot SKIP LOCKED
)
UPDATE "OutreachTask" ot
SET status = 'CALLING', "lockedBy" = $3, "lockedAt" = NOW()
FROM selected WHERE ot.id = selected.id
RETURNING ot.id, ot."patientId", ot."campaignId";
```

**Why this approach:**

- `FOR UPDATE ... SKIP LOCKED` is Postgres's native mechanism for safe
  concurrent queue consumption: if two workers call this simultaneously,
  each gets a disjoint set of rows — the database itself guarantees no two
  workers can select the same task, with no application-level locking
  needed.
- Wrapping the selection and the status update in a single `UPDATE ... FROM
  (SELECT ...)` statement makes "pick the best N" and "claim them" atomic —
  there's no window between selecting and claiming where a second worker
  could grab the same rows.
- `LIMIT` is computed as `outboundCapacity - COUNT(active CALLING/CONNECTED
  tasks)`, recalculated on every claim call, so the true concurrency ceiling
  is enforced even as tasks complete and free up capacity mid-run.
- This was verified live (see `simulation/queue-simulation.ts` and the
  earlier manual test): with `outboundCapacity=14` and 18 eligible tasks, a
  single claim call reserved exactly 14 — never more.

## 5. Retry & Backoff Strategy

Non-terminal outcomes (`NO_ANSWER`, `BUSY`, `VOICEMAIL`, `DROPPED`,
`FAILED`) move the task to `RETRY_SCHEDULED` with an increasing backoff:

This is a simple fixed-step backoff (not exponential) chosen because
clinical follow-up windows are typically measured in single-digit hours to
a few days — an exponential curve would push later retries out further than
useful within most follow-up windows. Once `attemptCount >= maxAttempts`
(derived from `campaign.maxRetries + 1`), the task moves to the terminal
`MANUAL_FOLLOW_UP` state instead of retrying further, making it visible to
staff rather than silently disappearing.

## 6. Callback Handling

A callback request bypasses the generic backoff schedule entirely: the
task moves to `CALLBACK_SCHEDULED` with `scheduledFor` and
`callbackRequestedAt` set to the patient's specific requested time. Once
that time passes, the priority scorer applies a strong (+25) bonus so the
callback is honored close to the requested time rather than getting stuck
behind the generic queue.

## 7. Deadline / Clinical Cutoff Behavior

`clinicalDeadline` is computed at task-creation time as
`encounter.dischargeTimestamp + encounter.followUpWindowHours`. The
deadline-urgency term in the priority formula (Section 3) means a task
within 2 hours of its deadline scores 40 points — higher than the maximum
possible campaign-priority contribution (20) — ensuring imminent-deadline
patients are surfaced first regardless of which campaign they belong to.
Dashboards separately expose a `tasksNearCutoff` count (tasks within 2 hours
of deadline) for operational visibility (Section 22).

## 8. Fairness / Starvation Prevention

Two mechanisms work together to prevent starvation in both directions:

- **Retry penalty is capped** (max -15 points) so a repeatedly-failing task
  can never be pushed so far down the queue that it's permanently
  unreachable — it will still eventually surface, especially as its
  deadline approaches and the urgency term grows.
- **Fresh tasks aren't starved by aggressive campaigns**, because campaign
  priority contributes a bounded maximum (20 points) rather than an
  unbounded multiplier — a single high-priority campaign cannot completely
  monopolize capacity indefinitely against tasks with genuine deadline
  pressure.

## 9. Failure Recovery (Worker Crash Handling)

If a worker claims a task (moving it to `CALLING`) and then crashes before
recording an outcome, that task would otherwise be stuck forever, silently
consuming capacity. `recoverStaleLocks()` (callable via
`POST /queue/recover-stale`, intended to run on a periodic schedule)
finds any task in `CALLING` status whose `lockedAt` timestamp is older than
a 5-minute staleness threshold, and either:

- returns it to `PENDING` (incrementing `attemptCount`) if attempts remain, or
- moves it to `MANUAL_FOLLOW_UP` if max attempts have been exhausted.

This directly satisfies the PRD's requirement that "a failed worker should
not permanently consume outbound capacity."

## 10. Duplicate Prevention

Duplicate calls/side-effects are prevented by construction: a task can only
be claimed while in `PENDING`/`RETRY_SCHEDULED`/`CALLBACK_SCHEDULED` status,
and claiming atomically transitions it to `CALLING` in the same SQL
statement that selects it — so no other worker can select an
already-`CALLING` task. Campaign activation similarly checks for existing
`OutreachTask` rows per patient before creating new ones, so resuming a
paused campaign or re-activating never creates duplicate tasks for the same
patient (Section 8's "resuming should recalculate eligible work rather than
blindly restarting").