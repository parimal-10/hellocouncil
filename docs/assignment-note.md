# Long-Running Agents Platform Note

## Design Chosen

This slice implements a reusable platform around long-running legal-agent workflows. It includes a LiveKit browser voice runtime backed by a separate LiveKit Agents Node worker, and real Twilio outbound calling for scheduled follow-ups. This phase uses LiveKit Cloud and LiveKit Inference only; it does not configure direct third-party model-provider credentials.

The reusable platform/framework approach was chosen because the durable workflow primitives, review controls, audit trail, and provider seams are shared across legal-agent use cases. Keeping those concerns generic lets new workflows vary through definitions and policies instead of duplicating operational infrastructure, while preserving a clear migration path to a production voice runtime and production-grade orchestration (now realized with self-hosted Temporal).

## Product and Platform Primitives

- Workflow definitions
- Workflow runs
- Durable workflow steps
- Human review requests
- Contact attempts
- Append-only workflow events
- LiveKit voice sessions
- Twilio phone calls with transcribed conversations
- Structured workflow actions
- Lightweight legal context for cases, people, and organizations

## Implemented

- Operations dashboard
- Workflow detail view
- Review queue
- LiveKit browser voice runtime with microphone transport
- Medical-records follow-up definition
- Client check-in definition
- DB-backed workflow state (projections for UI reads)
- Temporal worker entrypoint with durable timers, retries, and signal/query driven recovery
- Retryable activity execution with retry-limit enforcement
- HITL policy
- Distinct assign, approve, edit, reject, resolve, and note-only review actions
- Persisted LiveKit room, participant, and dispatch metadata
- Seeded demo data
- Case creation from the UI, including client/provider contacts and optional immediate workflow start
- Follow-up orchestration: due client check-ins and provider follow-ups place real Twilio calls autonomously; conversations are transcribed, structured outcomes are extracted, and every scheduling decision is audited

One intentional behavior change from the Temporal migration: voice-agent `run_follow_up_now` / `schedule_follow_up` actions are now asynchronous. The voice tool acknowledges with "Follow-up requested. The workflow will place the call shortly." instead of executing the call synchronously; the workflow picks the request up via signal and places the call on its own schedule.

The workflow execution model is backed by self-hosted Temporal: one workflow execution per workflow run (`workflow-run-${workflowRunId}`) owns durable timers, retries, and recovery across restarts. The Next.js app starts and signals executions through the Temporal client; a separate worker process (`npm run worker`, task queue `hellocouncil-workflows`) hosts the workflow and activity code. Call completion, review resolution, and voice-agent follow-up requests arrive as signals (`callCompleted`, `reviewResolved`, `runFollowUpNow`, `scheduleFollowUp`), current state is exposed as the `runState` query, and external IO (Twilio dialing, persistence) happens in activities so workflow code stays deterministic. Postgres holds projections of runs, steps, events, and reviews for UI reads — it is no longer the scheduling or recovery authority.

Client/case local time is stored as an IANA timezone on `people`. Scheduled instants remain `timestamptz` (UTC). Conversion through `src/modules/time/timezone.ts` is the shared boundary.

Automatic outbound calling is gated by `AUTO_OUTBOUND_CALLS=true`; without it (or without a configured Twilio runtime) due follow-up steps fail loudly instead of falling back to a simulation. The follow-up policy lives in `src/modules/phone/follow-up-policy.ts` (`FOLLOW_UP_POLICY`, id `follow-up-v1`):

- Calling window: Monday–Friday, 9:00 AM–5:00 PM in the client's IANA timezone (narrower than the TCPA quiet-hours flag of 8:00 AM–9:00 PM used on the manual path). US holidays are not skipped.
- Follow-ups explicitly requested through the voice agent or UI honor the requested instant and are never deferred to the business-hours window.
- Connected + explicit callback: schedule that exact instant (not snapped to business hours).
- Connected + concluded: agent `recommendedFollowUpHours` if present (clamped 4–336 hours), else 24 hours when urgency is high, else the workflow default (72 hours for client check-in). These intervals snap forward into the calling window.
- No connect (no-answer / voicemail / busy / failed): retry 1 in 2 hours (snapped), retry 2 at 10:00 AM local next business day, then human review after 3 unsuccessful connect attempts.
- Client asked to stop: no further automatic calls.

Every decision is written as a `scheduling.decision` workflow event with action, reason, policy id, dueAt, and metadata — not just the resulting timestamp.

## Stubbed

- SMS, email, and provider portal integrations
- Authentication and firm tenancy
- Production observability

## Where It Breaks Down Today

The LiveKit browser runtime requires a credentialed LiveKit Cloud environment and must be verified manually; it is not exercised by automated Cloud E2E tests. Real call outcomes depend on Twilio status webhooks reaching `PUBLIC_BASE_URL`, so local verification needs a public tunnel.

The DB-backed runner has been replaced by self-hosted Temporal, which now owns timers, retries, and recovery; Temporal is the production-grade orchestration layer for workflow branching and multi-month durations. The domain primitives remain explicit in Postgres projections so they continue to map cleanly to workflows, activities, signals, and queries.

The demo seed is intentionally non-idempotent and should be run against a fresh local database. Production-grade seed reconciliation remains outside this assignment slice.

## Adding a New Use Case

Add a new `WorkflowDefinition` with metadata, step templates, schedule policy, review policy, and allowed actions. Add seed data or a creation path, then add any new structured outcomes the worker should understand. The dashboard, review queue, audit timeline, and voice action router should not require workflow-specific changes.

For example, a lien verification workflow could define a lienholder follow-up step, block on disputed amounts or missing authorization, and complete when the lien status is confirmed.

## What to Build Next

1. Add authentication, firm tenancy, and role-based review permissions.
2. Add worker observability and stuck-step alerts.
3. Harden the Temporal deployment: workflow versioning, production cluster, and namespace management.
