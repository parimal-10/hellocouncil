# Temporal Runner Migration Design

Date: 2026-08-26

## Goal

Migrate the DB-backed (pg-boss + reconcile loop) workflow runner to self-hosted Temporal. Temporal owns durable execution, timers, retries, signal handling, and recovery from process failures. Postgres remains the domain read/projection model so the dashboard, timelines, review queue, and audit trail keep working unchanged. Existing application behavior is preserved.

## Current Architecture (baseline)

- State authority: Postgres — `workflow_runs`, `workflow_steps` (`dueAt`, `attemptCount`, payload, scheduling-claim columns), `workflow_events`, `human_review_requests`, `contact_attempts`, `phone_calls`.
- `WorkflowEngine` (src/modules/workflows/engine.ts): claims due steps, enforces the business-hours calling window, blocks on HITL policy, places Twilio calls via `OutboundFollowUpPort`, applies follow-up decisions (retry / defer / complete / human review / schedule next).
- Scheduling: worker reconcile loop scans for due-but-unscheduled steps every 60s and enqueues pg-boss delayed jobs; pg-boss delivers `workflow.run-due-step` jobs back into the engine. pg-boss is a queueing mechanism only; DB claim columns are the authority.
- Completion path: Twilio status webhook persists transcript/structured outcome, then synchronously applies orchestration.
- Failure recovery: manual attempt counting vs template retry limits, scheduling claims with expiry, reconcile-loop re-enqueue.

Problems this migration removes: dual scheduling authorities (DB claims + queue), a polling reconcile loop, manual job-recovery logic, and no native durability for long waits.

## Runtime Topology

docker-compose additions (same file as postgres):

| Service | Image | Purpose |
|---|---|---|
| `temporal` | `temporalio/auto-setup` | Self-hosted Temporal server; storage = existing postgres container (`DB=postgres12`, `DBNAME=temporal`, `POSTGRES_SEEDS=postgres`) |
| `temporal-ui` | `temporalio/ui` | Web UI on :8080 |

App namespace: `hellocouncil`. The temporal database is separate from the app database; app tables are untouched.

Local processes:

1. `docker compose up -d` → postgres + temporal + UI
2. `npm run db:migrate && npm run db:seed`
3. `npm run dev` → Next.js
4. `npm run worker` → repurposed: a `@temporalio/worker` process connecting to `TEMPORAL_ADDRESS` on task queue `hellocouncil-workflows`, hosting workflows and activities. No reconcile interval.
5. `npm run voice:agent` → unchanged

Environment: add `TEMPORAL_ADDRESS=localhost:7233`, `TEMPORAL_NAMESPACE=hellocouncil`. Remove `PG_BOSS_SCHEMA`. Keep `AUTO_OUTBOUND_CALLS=true` requirement: due follow-ups place real Twilio calls; there is no simulated fallback.

A `src/temporal/client.ts` singleton provides the Next.js server, webhook routes, seed script, and action handlers a connected `WorkflowClient`.

## Workflow Model and Mapping

One generic durable workflow implementation per product workflow run (Approach A). One execution per run, parameterized by `definitionId`.

| Current concept | Temporal concept |
|---|---|
| Start run from case creation / seed | `WorkflowClient.start(workflowRunWorkflow, { definitionId, caseId, ... })`; run row stores `temporal_workflow_id` |
| Step `dueAt` + pg-boss delayed job + reconcile loop | Durable timer: `sleep(until step.dueAt)` |
| `advanceDueStep()` claim/window/dial logic | Activity `executeDueStep`; window-defer loops back to another timer |
| Twilio webhook applying orchestration synchronously | Webhook persists outcome (unchanged), then signals `callCompleted`; workflow runs pure policy inline and persists transitions via activities |
| Human review block | Indefinite signal wait on `reviewResolved` |
| Voice-agent actions | Signals `runFollowUpNow`, `scheduleFollowUp`; query `getRunState` |
| Retry limit / claim recovery | Activity `RetryPolicy.maximumAttempts = template.retryLimit` for infra retries; domain retry ladder stays a policy decision |
| Dashboard/timeline/review reads | Unchanged Postgres projections written by activities |

Both definitions (`medical-records-follow-up`, `client-check-in`) plug into the same workflow via `definitionId`. Adding a use case remains a definition-object change.

## Module Layout

```
src/temporal/
  client.ts                   WorkflowClient singleton
  worker.ts                   worker entrypoint (connection, namespace, task queue)
  workflows/workflow-run.ts   durable run workflow (deterministic code only)
  activities/persistence.ts   DB projection activities over DrizzleWorkflowStore
  activities/outbound-call.ts placeCall / evaluateWindow (wraps existing dialer)
```

Determinism boundary: `workflow-run.ts` imports only pure modules (`follow-up-policy`, `review-policy`, `definitions`, `types`) and the Temporal SDK. All IO goes through activities. The bundler fails loudly on violations.

Activities delegate to existing store/engine helpers so transition behavior stays identical:

- `persistWorkflowStarted` — writes `temporal_workflow_id` + `workflow.started` event
- `executeDueStep({ runId, stepId })` — today's `advanceDueStep()` body relocated; returns `{ kind: "placed" } | { kind: "deferred_to_window", dueAt } | { kind: "blocked_for_review", decision } | { kind: "already_claimed" }`
- `recordSchedulingDecision`, `createFollowUpStep`, `completeStep`, `blockForReview`, `updateRunStatus`, `appendEvent`, `resolveReviewProjection`, `createContactAttempt` — thin projections

Retry policies: persistence activities retry indefinitely with short backoff; `executeDueStep` uses `maximumAttempts = template.retryLimit`.

Signals/queries:

- `callCompleted: { callId }` — reads the phone-call outcome (read activity), applies `decideNextFollowUp` and the HITL policy inline, persists transitions
- `reviewResolved: { reviewRequestId, resolution, note, assignedUserId }` — mirrors today's `resolveBlockedStep` projections, resumes or fails the run
- `runFollowUpNow`, `scheduleFollowUp` — mirror voice-agent tool semantics; explicit requests bypass window snap (`requestedByUser`)
- `getRunState` query for UI/debug reads

## Failure, Timeout, Recovery Semantics

- Worker crash/restart: Temporal replays history; timers and signal waits resume automatically. Replaces the reconcile loop's recovery role.
- Activity failure: per-activity retry policies; exhausting `executeDueStep`'s limit transitions step/run to `failed` with a `step.processing_failed` event (same as `recoverClaimedStep` today).
- Long calls: after placing a call the workflow waits on `callCompleted` with no timeout; Twilio status callbacks are authoritative. The dial activity has a `startToClose` timeout to guard hung API calls.
- Duplicate/early signals: `claimOrchestration` on the phone-call row dedupes before signaling; Temporal buffers early signals; outcomes for steps not being waited on are ignored.
- Orphaned runs (DB restored without execution history): out of scope, documented limitation.

## Schema Changes (single Drizzle migration)

- Add `workflow_runs.temporal_workflow_id text` (+ index)
- Drop `workflow_steps.queue_job_scheduled_at` and `queue_scheduling_claim_until`

No other table changes; events/steps/runs/reviews remain projections.

## Code Changes

New: `src/temporal/` module; `src/worker/start.ts` becomes the Temporal worker bootstrap reusing outbound dialer config.

Deleted: `src/worker/boss.ts`, `src/worker/reconcile-due-steps.ts`, `src/worker/run-due-step.ts`, `WorkflowStepScheduler` port, pg-boss dependency and `PG_BOSS_SCHEMA`.

WorkflowEngine: shrinks to synchronous app-side actions and shared transition helpers reused by activities; scheduling branches removed. Target: no dead paths.

Callers rewired:
- Case creation starts a Temporal workflow after inserting the run row
- Twilio status webhook signals `callCompleted`
- Review actions resolve projection + signal `reviewResolved`
- Voice-agent tools signal `runFollowUpNow` / `scheduleFollowUp`
- Seed script starts real executions

Config/docs: `.env.example`, README, docker-compose updated; assignment note and design docs gain a migration section.

## Testing Strategy

- Unit tests unchanged: follow-up policy, review policy, definitions, timezone, action-router logic are re-imported into workflow scope, not rewritten
- Workflow tests: `@temporalio/testing` test environment with time-skipping — timer fires step → call placed → `callCompleted` → next scheduled; no-answer retry ladder through time-skip; failed-connect threshold → human review block; `reviewResolved` approved resumes / rejected fails; voice `runFollowUpNow` bypasses window snap
- Integration tests: existing `tests/worker-transitions.test.ts` assertions re-targeted at the activity layer with the fake store
- Manual failure-recovery verification against real self-hosted server: kill/restart worker mid-timer; duplicate `callCompleted` idempotency; observed in the Temporal UI
- Gate: `npm run test:run && npm run lint && npm run build`

## Decision Log

1. One workflow execution per run (Approach A): preserves the run as the product primitive; natural HITL via indefinite signal waits; native restart recovery.
2. Postgres kept as read/projection model: dashboards, timelines, and review queue unchanged; append-only audit story preserved.
3. Pure policy code moves into workflow scope: functions are already deterministic, so decisions become part of replayable history.
4. pg-boss removed entirely: one execution path, no drift.
5. Domain retry ladder unchanged: failed-connect semantics are business policy, not infra retry.
6. `AUTO_OUTBOUND_CALLS` gating preserved: no simulated fallback was an explicit prior decision.

## Limitations

- Orphaned runs after out-of-band DB restores are undetectable in scope.
- LiveKit/Twilio end-to-end verification still requires external credentials and a public tunnel, unchanged from the current system.
- Seed remains non-idempotent against a fresh local database.
