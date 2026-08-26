# HelloCounsel Long-Running Agents Platform Architecture

This document explains the core platform architecture behind the HelloCounsel long-running agents slice. It intentionally avoids UI discussion and focuses on the reusable platform behavior: workflow definitions, durable execution, state projections, human review, phone and voice integrations, auditability, and extension points.

## Diagrams

- [Main architecture](diagrams/main-architecture.excalidraw)
- [Temporal workflow lifecycle](diagrams/temporal-workflow-lifecycle.excalidraw)
- [Outbound call orchestration](diagrams/outbound-call-orchestration.excalidraw)
- [Human review and controlled actions](diagrams/human-review-action-control.excalidraw)
- [Adding a new use case](diagrams/new-use-case-extension.excalidraw)

Each diagram has a PNG render beside the `.excalidraw` file after running the renderer.

## Original Assignment

The assignment asks for a working slice of a platform that can power long-running AI agents for plaintiff law firms. The platform must handle workflows that unfold over time: repeated follow-up, changed facts, scheduled outreach, blocked automation, and human intervention.

The two anchor workflows are:

- Medical records follow-up: an agent follows up with medical providers and reports status back to the firm.
- Client check-in: an agent periodically checks in with a client and brings meaningful updates back to the firm.

The key constraint is that the implementation must not be a hard-coded solution for only those two workflows. It must show the underlying platform primitives that would let another legal-agent use case plug in with minimal platform changes.

The implementation therefore optimizes for these evaluation points:

- Judgment under ambiguity: choose a practical slice that proves long-running behavior without trying to build a whole case-management system.
- Quality of abstraction: isolate what varies by workflow from what every workflow shares.
- Extensibility: define new use cases through workflow definitions, policies, and structured outcomes.
- Product thinking: include blocked states, review paths, audit history, contact attempts, and legal context.
- Practical tradeoffs: use real durability and real phone execution where it matters, while keeping the first slice small.

## Chosen Design

The central design is:

```text
one durable workflow execution per workflow run
+ workflow definitions as data
+ controlled action routing
+ Postgres projections and audit events
+ Temporal for timers, signals, retries, and recovery
```

The platform is not implemented as two separate workflows. Medical records follow-up and client check-in are two `WorkflowDefinition` objects behind the same interface. That choice is visible in `src/modules/workflows/definitions.ts`: both definitions provide metadata, step templates, allowed actions, a review policy, and a next-step scheduling function.

This keeps the engine generic. The engine does not know "medical records" as a special process. It knows how to apply controlled workflow actions, update run and step state, create human review requests, append events, and schedule/complete steps. The workflow definition supplies the use-case-specific facts.

## Current High-Level Architecture

The current runtime has five core areas:

1. Domain state and projections in Postgres.
2. Workflow definitions and workflow engine modules.
3. Temporal workflow execution and activities.
4. Communication adapters for Twilio phone calls and LiveKit browser voice sessions.
5. Human-in-the-loop controls and append-only audit events.

The important flow is:

```text
case/workflow creation
  -> workflow run row + first workflow step
  -> Temporal workflow started as workflow-run-{workflowRunId}
  -> Temporal sleeps until a due step or signal
  -> executeDueStep activity claims the due step
  -> outbound Twilio call is placed
  -> Twilio status webhook persists terminal call facts
  -> webhook signals callCompleted
  -> Temporal applies follow-up policy through an activity
  -> WorkflowEngine updates projections and audit events
  -> loop continues, waits for review, schedules next step, or ends
```

Postgres remains the readable product model. Temporal owns execution durability. This split matters: users and operators need queryable tables for dashboards, review queues, case files, and timelines; Temporal needs to own timers, signal delivery, replay, retry, and worker restart recovery.

## Main Modules

### Workflow Definitions

Files:

- `src/modules/workflows/types.ts`
- `src/modules/workflows/definitions.ts`

The workflow definition interface is the primary extension seam:

```ts
export type WorkflowDefinition = {
  id: WorkflowDefinitionId;
  label: string;
  description: string;
  requiredContext: Array<"case" | "client" | "provider" | "assigned_user">;
  stepTemplates: WorkflowStepTemplate[];
  allowedActions: WorkflowActionType[];
  reviewPolicy: (signal: WorkflowSignal) => ReviewDecision;
  scheduleNextStep: (context: ScheduleContext) => WorkflowStepTemplate | null;
};
```

This is deliberately small. It hides a large amount of shared platform behavior behind a compact interface. A new use case should mostly add a new definition object instead of changing the engine, review queue, audit timeline, Temporal workflow loop, or voice tool bridge.

Existing definitions:

- `medical-records-follow-up`
  - Requires case, client, provider, and assigned user context.
  - Uses `provider_follow_up` steps.
  - Completes when the signal text says records are ready.
  - Otherwise schedules another provider follow-up.
- `client-check-in`
  - Requires case, client, and assigned user context.
  - Uses `client_check_in` steps.
  - Continues as a recurring check-in workflow.

Decision: typed definitions instead of database-configured workflows.

Why: this assignment needs quality of abstraction and correctness more than no-code workflow authoring. TypeScript definitions make policy shape, step types, and allowed actions explicit and testable. A database-configured workflow builder would add a lot of authoring complexity before the core execution model is proven.

Alternative: store workflow definitions entirely in Postgres.

Tradeoff: this would make runtime configuration easier, but it would require schema and validation for a workflow DSL, migrations for policy changes, and a safer authoring model. That is useful later, but not for the first platform slice.

### Workflow Engine

Files:

- `src/modules/workflows/engine.ts`
- `src/modules/workflows/transitions.ts`
- `src/modules/workflows/action-router.ts`

`WorkflowEngine` is the central mutation module for workflow state. It applies structured actions and follow-up decisions. It writes current state and append-only events through the `WorkflowStore` interface.

The engine handles:

- `create_update`: update the run summary and append `action.create_update`.
- `request_review`: move the run to `waiting_for_human`, create a review, append `review.created`.
- `mark_contact_attempt`: create a contact attempt and append `action.mark_contact_attempt`.
- `schedule_follow_up`: create a due step and append `step.scheduled`.
- `resolve_blocked_step`: approve/edit/reject/resolve/assign a human review.
- `add_review_note`: append a review note event without changing execution state.
- `applyFollowUpDecision`: apply policy output after a phone call, including retry, defer, schedule, complete, or human review.

The engine is intentionally not a free-form state mutator. Callers cannot ask it to arbitrarily update a row. They must provide a known `WorkflowAction` or `FollowUpDecision`.

Decision: one controlled engine for all mutations.

Why: long-running legal workflows need auditability and predictable intervention points. If the voice agent, phone webhook, worker, and review action code could all mutate workflow tables directly, the rules would scatter and the platform would become workflow-specific. A single mutation module creates locality: validation, status transitions, and audit writes live together.

Alternative: let each integration update database rows directly.

Tradeoff: direct writes are faster to build at first, but they make retries, duplicate webhook handling, review state, and audit consistency much harder. They also give agents too much power in a legal context.

### Workflow Action Router

File:

- `src/modules/workflows/action-router.ts`

The action router checks whether a workflow definition allows a requested action before sending it to the engine.

This is a small module with an important job: it keeps agents and adapters on the same permission path. New workflows can narrow or expand allowed actions through their definition.

Decision: structured workflow actions instead of natural-language agent commands.

Why: the platform must be auditable and safe. Structured actions make every agent mutation inspectable, validateable, and testable. Natural-language commands would require ad hoc parsing and would make it unclear which workflow state changes were actually authorized.

Alternative: let the LLM produce arbitrary JSON patches or SQL-like instructions.

Tradeoff: that might be flexible, but it is unsafe and hard to review. The project explicitly keeps approve/reject/resolve/assign human-only; arbitrary mutation would break that rule.

### Human Review Policy

File:

- `src/modules/workflows/review-policy.ts`

The human review policy is deterministic. It evaluates a `WorkflowSignal` and returns either:

- `{ kind: "allow" }`
- `{ kind: "block", reason, severity, recommendedAction, summary }`

It blocks for:

- Missing provider authorization.
- Sensitive legal-advice or legal-strategy content.
- Ambiguous client responses.
- Provider refusal.
- Failed contact threshold.

Decision: centralized deterministic human-in-the-loop policy.

Why: every channel should stop automation for the same reasons. A deterministic function is easy to test and explain. It also gives the product a clear review queue reason rather than a vague "agent was uncertain" state.

Alternative: rely on the LLM to decide when to escalate.

Tradeoff: the LLM can help summarize and classify, but the platform should own the final stop/go policy. Legal workflows need conservative, inspectable rules.

### Workflow Step Execution

Files:

- `src/modules/workflows/execution.ts`
- `src/modules/workflows/transitions.ts`

`advanceDueStep` is the activity-friendly due-step executor. It does the runtime work for one due step:

1. Load the step.
2. Ignore it if it is not due.
3. If it is not explicitly requested, check the local business-hours calling window.
4. Atomically claim the step by moving it from `due` to `running` and incrementing attempt count.
5. Block provider follow-up if authorization is missing.
6. Require an outbound caller for due phone work.
7. Place the auto-dial call.
8. Mark the step payload with `outboundCallId` and `awaitingCallCompletion`.
9. Recover a claimed step on failure, either retrying or failing based on the step template's retry limit.

The claim is important. Duplicate workers or duplicate activity deliveries can try to execute the same step, but only one update can transition a due step to running.

Decision: execution logic extracted from the engine.

Why: Temporal workflows must keep deterministic code separate from IO. `advanceDueStep` can run as a Temporal activity because it contains IO and database mutations. The workflow loop can call it without importing Drizzle, Twilio, or non-deterministic runtime code.

Alternative: keep all execution inside `WorkflowEngine`.

Tradeoff: a larger engine would be easier to find initially, but harder to safely import into Temporal and harder to test as a focused due-step executor.

## Temporal Runner

Files:

- `src/temporal/config.ts`
- `src/temporal/client.ts`
- `src/temporal/start-run.ts`
- `src/temporal/worker.ts`
- `src/temporal/workflows/workflow-run.ts`
- `src/temporal/activities/index.ts`
- `src/temporal/activities/runtime.ts`
- `src/temporal/activities/types.ts`

The runner uses one Temporal workflow execution per product workflow run. The workflow id is:

```text
workflow-run-{workflowRunId}
```

The task queue is:

```text
hellocouncil-workflows
```

The default namespace is:

```text
hellocouncil
```

The workflow accepts `{ workflowRunId }` and repeatedly asks activities for the current projection state:

```ts
export type RunStateSnapshot = {
  runStatus: WorkflowRunStatus;
  awaitingCallCompletion: boolean;
  openReviewId: string | null;
  dueStepId: string | null;
  nextDueAt: number | null;
};
```

The workflow's core decisions are:

- If run status is terminal, return.
- If a call is in progress, wait for `callCompleted`.
- If a review is open or assigned, wait for `reviewResolved`.
- If a due step exists, execute it.
- If a future due step exists, sleep until its due time or until a signal arrives.
- If nothing is pending, sleep until a signal arrives.

Signals:

- `callCompleted { callId }`
- `reviewResolved`
- `runFollowUpNow`
- `scheduleFollowUp { stepType, dueAt, reason }`

Query:

- `runState`

Decision: Temporal instead of the original pg-boss plus reconcile-loop runner.

Why: the original DB-backed runner made primitives visible and worked for the initial slice, but long-running workflows need first-class durable timers, signal waits, workflow history, retry policies, and crash recovery. Temporal removes dual scheduling authority, polling reconciliation, manual claim expiry, and queue recovery logic.

Alternative: keep Postgres as execution authority with a polling worker and queue.

Tradeoff: Postgres remains excellent for product state and audit queries, but it is not as strong as Temporal for multi-day or multi-month execution. A DB runner needs custom logic for every hard part Temporal already owns: durable sleeps, replay, signal delivery, retries, and worker crash recovery.

Decision: keep Postgres as the projection/read model even after migrating to Temporal.

Why: the product still needs direct tables for cases, runs, steps, events, reviews, phone calls, and voice session history. Temporal history is not a replacement for operational read models or legal audit tables.

Alternative: query Temporal directly for everything.

Tradeoff: Temporal history is great for execution debugging, but it is not the right primary data source for dashboards, review queues, search, reports, or legal context joins.

Decision: activities own all IO.

Why: Temporal workflow code must be deterministic. Drizzle queries, Twilio calls, and clock-based decisions belong in activities. Pure policy code can be used from workflow-adjacent logic, but side effects cannot.

Alternative: import application stores into the workflow file.

Tradeoff: that would risk non-deterministic workflow replay and make Temporal behavior fragile.

## Persistence Model

File:

- `src/db/schema.ts`

The database contains two kinds of tables:

- Legal context and communication context.
- Workflow projections and audit history.

Legal context:

- `people`: clients, firm users, timezone source, phone, email.
- `organizations`: providers and law firms.
- `cases`: matter name, status, assigned firm user.
- `case_participants`: role mapping between a case and people/organizations.

Workflow state:

- `workflow_runs`: current run status, definition id, case id, title, summary, Temporal execution id.
- `workflow_steps`: durable step rows with type, label, status, due time, attempt count, and payload.
- `workflow_events`: append-only audit trail.
- `human_review_requests`: human review items with status, reason, severity, recommendation, owner, and note.
- `contact_attempts`: channel-level contact attempts.

Voice and phone state:

- `voice_sessions`: LiveKit or simulated session metadata.
- `voice_session_events`: transcript chunks, conversation items, tool calls, tool results, and session lifecycle events.
- `phone_calls`: Twilio call state, transcript, structured outcome, compliance flags, and idempotent orchestration claim.

Decision: append-only audit events plus current-state tables.

Why: current-state tables make reads cheap and simple. Append-only events preserve the operational and legal story of how the run changed over time. Rebuilding all state from events would be overkill for this slice; storing only current state would lose the audit trail.

Alternative: pure event sourcing.

Tradeoff: event sourcing gives a stronger history model, but it adds projection rebuild complexity and schema discipline that this platform slice does not need yet.

Alternative: only mutable rows.

Tradeoff: mutable rows are easy to query, but they cannot explain why a follow-up was scheduled, who resolved a review, whether an agent requested a tool, or why automation stopped.

## Outbound Phone Runtime

Files:

- `src/modules/phone/service.ts`
- `src/modules/phone/orchestration.ts`
- `src/modules/phone/follow-up-policy.ts`
- `src/modules/phone/store.ts`
- `src/modules/phone/context.ts`
- `src/modules/phone/conversation.ts`
- `src/modules/phone/outcomes.ts`
- `src/modules/phone/compliance.ts`
- `src/modules/phone/status.ts`
- `src/modules/phone/worker-dialer.ts`
- `app/api/twilio/voice/route.ts`
- `app/api/twilio/turn/route.ts`
- `app/api/twilio/status/route.ts`

The phone runtime places real Twilio calls for due follow-up steps. There is no silent simulation fallback for the worker path. `AUTO_OUTBOUND_CALLS=true` must be set, and the worker refuses to start without it.

The phone flow:

1. Temporal executes a due step.
2. `advanceDueStep` calls the outbound dialer.
3. The dialer loads case/run/client/provider context.
4. `placeOutboundCall` chooses the right callee.
5. Compliance flags are calculated.
6. A `phone_calls` row is created before Twilio is called.
7. Twilio receives voice and status webhook URLs.
8. The Twilio call sid is persisted.
9. `phone_call.initiated` is appended.
10. Twilio voice/turn webhooks gather speech and append transcript turns.
11. A terminal Twilio status callback updates call state.
12. If a transcript exists, an LLM extracts a structured outcome.
13. The status webhook signals `callCompleted` to Temporal.
14. Temporal calls `applyCallOutcome`.
15. `applyOutboundCallFollowUp` idempotently claims orchestration and applies scheduling policy through the workflow engine.

Decision: real Twilio calling for due follow-ups.

Why: the platform claim is about long-running follow-up agents, and the high-value path is autonomous outreach. A fake call path would hide the actual failure modes: missing phone numbers, webhook delivery, terminal status mapping, transcript extraction, callback scheduling, and duplicate callbacks.

Alternative: simulate all external communication.

Tradeoff: simulation is excellent for tests and early architecture, but it would not prove the core platform behavior under real communication callbacks.

Decision: no worker simulation fallback.

Why: a due production-like follow-up should either place a real call or fail loudly. Silent fallback would make operators believe outreach happened when it did not.

Alternative: fallback to synthetic responses when Twilio is missing.

Tradeoff: easier local demos, but dangerous semantics for a platform whose core function is follow-up.

## Follow-Up Policy

File:

- `src/modules/phone/follow-up-policy.ts`

The scheduling policy id is `follow-up-v1`.

Current rules:

- Automatic calls are placed Monday through Friday, 9:00 AM to 5:00 PM in the client's IANA timezone.
- Explicit user-requested follow-ups are allowed at the requested instant and do not snap to the business-hours window.
- A connected call with an explicit callback schedules that exact resolved instant.
- A connected call with a recommended follow-up interval uses the recommendation, clamped to 4-336 hours, then snapped into the calling window.
- A connected high-urgency call schedules in 24 hours, snapped into the calling window.
- A normal connected call uses the workflow default interval, usually 72 hours for client check-ins.
- A first no-connect retries in 2 hours, snapped into the calling window if needed.
- A second no-connect schedules the next business day at 10:00 AM local.
- Three failed connect attempts produce human review.
- If the client asks to stop outreach, automation completes and does not schedule another call.

Decision: put scheduling in a named policy with audited decisions.

Why: "why did the platform call then?" is a product and compliance question. Every scheduling decision is appended as `scheduling.decision` with policy id, action, reason, due time, metadata, call id, and step id. That makes the behavior explainable and debuggable.

Alternative: compute the next `dueAt` inline wherever a call completes.

Tradeoff: inline scheduling would be shorter, but it would scatter policy, make tests weaker, and make future policy changes risky.

Decision: store client local timezone as IANA, store scheduled instants as UTC timestamps.

Why: legal operations happen in the client's local time, but databases and durable timers need unambiguous instants. `src/modules/time/timezone.ts` is the conversion seam. It validates IANA zones, infers from NANP area codes when needed, rejects ambiguous UTC-like client expressions, and handles DST gaps.

Alternative: store local wall-clock strings only.

Tradeoff: that may be readable to people, but it creates ambiguity for timers and DST.

Alternative: store only UTC without timezone source.

Tradeoff: timer execution becomes easy, but conversations and callback scheduling lose local context.

## LiveKit Browser Voice Runtime

Files:

- `src/modules/livekit/config.ts`
- `src/modules/livekit/token.ts`
- `src/modules/livekit/orchestration.ts`
- `src/voice-agent/agent.ts`
- `src/voice-agent/tools.ts`
- `src/voice-agent/lifecycle.ts`
- `src/voice-agent/start.ts`
- `src/modules/voice/store.ts`

LiveKit handles real browser microphone sessions. The Next.js app creates the room/token and persists a pending voice session. A separate LiveKit Agents Node worker joins the room, runs STT/LLM/TTS through LiveKit Inference, and exposes conservative workflow tools.

The launch flow:

1. Server receives only `workflowRunId`.
2. Server loads the persisted run and derives case id and definition id.
3. Server validates that the workflow definition exists.
4. Server creates a unique `launchId`, room name, and participant identity.
5. Server inserts a pending `voice_sessions` row.
6. Server creates a LiveKit agent dispatch with metadata containing `voiceSessionId`, `launchId`, and room name.
7. Server stores the dispatch id.
8. Server returns a LiveKit token scoped to the one room.
9. Browser joins the room.
10. Worker validates dispatch metadata against the pending persisted session before starting.

Decision: LiveKit Agents Node worker as a separate process.

Why: realtime voice sessions are long-lived and event-driven. They should not live inside request/response handlers. A separate worker can own room connection, VAD, turn detection, STT, LLM, TTS, transcript event handling, tool execution, and shutdown handling.

Alternative: run the voice agent inside Next.js actions or route handlers.

Tradeoff: simpler deployment for a demo, but wrong lifecycle for realtime audio and likely to break under serverless/request timeouts.

Decision: LiveKit Cloud and LiveKit Inference only for the first real voice runtime.

Why: it avoids adding separate provider credential paths for OpenAI, Deepgram, Cartesia, or ElevenLabs before the LiveKit runtime is proven. The platform still exposes model names through LiveKit configuration.

Alternative: wire direct provider SDKs immediately.

Tradeoff: direct SDKs give more control, but add credential sprawl and distract from the platform seam.

Decision: persist voice tool calls and results with idempotent tool-call claiming.

Why: LiveKit/LLM tool callbacks can repeat. `claimToolCall` inserts a `tool_call` event under a unique `(voiceSessionId, toolCallId, type)` index. Duplicate tool calls return the already persisted result instead of repeating workflow mutation.

Alternative: trust the runtime to call each tool once.

Tradeoff: simpler, but unsafe around retries and reconnects.

## Voice Tool Control

File:

- `src/voice-agent/tools.ts`

The voice agent may call:

- `get_workflow_status`
- `create_update`
- `request_review`
- `mark_contact_attempt`
- `schedule_follow_up`
- `run_follow_up_now`
- `add_review_note`

The voice agent may not call:

- approve review
- reject review
- resolve blocked step
- assign owner
- arbitrary database writes

`schedule_follow_up` creates a step through the engine and signals Temporal with `scheduleFollowUp`.

`run_follow_up_now` either reschedules an existing due step to now or creates an immediate due step, marks the payload as `requestedByUser`, and signals Temporal with `runFollowUpNow`.

Decision: asynchronous voice follow-up execution.

Why: after the Temporal migration, the voice tool should request execution and let the durable workflow place the call. That keeps timers, calling-window exceptions, crashes, and call completion in the workflow execution path. The voice tool returns: "Follow-up requested. The workflow will place the call shortly."

Alternative: have the voice tool place the call synchronously.

Tradeoff: the voice interaction would feel immediate, but it would bypass durable workflow ownership and make retry/recovery semantics harder.

## Human Review Flow

Files:

- `src/modules/workflows/review-policy.ts`
- `src/modules/workflows/engine.ts`
- `app/actions/review.ts`

Human review is a platform primitive, not a UI convenience. When automation blocks:

1. The step is marked `waiting_for_human`.
2. The run is marked `waiting_for_human`.
3. A `human_review_requests` row is created.
4. A `review.created` event is appended.
5. Temporal observes `openReviewId` and waits indefinitely for `reviewResolved`.

Review actions:

- `assigned`: assigns an owner and keeps the workflow waiting.
- `approved`: closes review, patches missing authorization if relevant, reschedules the blocked step to now, marks run active.
- `edited`: stores human context in step payload, reschedules step to now, marks run active.
- `resolved`: closes review and resumes.
- `rejected`: skips the step and fails the run.
- `note`: appends an audit event only.

Decision: humans own legal review resolution.

Why: in a legal operations setting, an AI agent can surface and summarize a block, but it should not approve, reject, or resolve the firm's review gate. The code enforces this by exposing only note-taking to voice tools.

Alternative: let the voice agent resolve review if it sounds confident.

Tradeoff: faster automation, but legally and operationally unsafe.

## Case Creation and Run Start

Files:

- `src/modules/cases/update.ts`
- `src/modules/cases/store.ts`
- `src/temporal/start-run.ts`

Case creation can optionally start a workflow. It validates the assigned owner, inserts the client and optional provider, creates the case, attaches participants, creates a workflow run, creates the first due step, appends `workflow.started`, and tries to start the Temporal execution.

If Temporal start fails, case creation still succeeds and the failure is recorded as `step.schedule_failed`. This is a deliberate availability tradeoff: the legal context should not be lost because the runner is briefly down. `signalWithStart` can recover on a later signal.

Decision: case creation does not fail just because Temporal is unavailable.

Why: the user-facing legal record and the workflow projection are valuable even if the runner needs recovery. The failure is audited, and later signals can start the workflow execution.

Alternative: make case creation transactional with Temporal start.

Tradeoff: stronger immediate execution guarantee, but it couples a legal data write to orchestration availability.

## Why This Architecture Works

The architecture works because it separates the parts that vary from the parts that must stay stable:

- Use cases vary through `WorkflowDefinition`.
- Execution durability stays in Temporal.
- Readable product state stays in Postgres.
- Mutations pass through `WorkflowEngine`.
- Agent requests pass through `routeWorkflowAction` and the voice tool allowlist.
- Phone outcomes pass through `applyOutboundCallFollowUp`.
- Scheduling passes through `follow-up-v1`.
- Review gates pass through `evaluateHumanReviewPolicy`.
- External runtimes sit behind adapters and stores.

This creates deep modules:

- `WorkflowDefinition` has a small interface but lets a new workflow use the whole platform.
- `WorkflowEngine` has a small action interface but owns many transitions and audit writes.
- `advanceDueStep` has a narrow `stepId + now + deps` interface but handles claiming, window checks, missing authorization, call placement, and recovery.
- `workflowRunWorkflow` has one input and four signals but owns long-running orchestration.
- `PhoneCallStore` and `WorkflowStore` keep persistence replaceable in tests without leaking SQL into policy code.
- `executeVoiceWorkflowTool` hides validation, idempotency, action conversion, engine routing, signal dispatch, and safe error handling behind one callable tool bridge.

The result is modular because each seam has a specific reason to exist and at least one real adapter or test fake:

- `WorkflowStore`: Drizzle implementation and test implementation.
- `PhoneCallStore`: Drizzle implementation and memory test implementation.
- `OutboundFollowUpPort`: worker Twilio dialer and fake dialers in tests.
- `SignalRunImpl`: real Temporal signaler and fake signalers in tests.
- `VoiceToolEventStore`: Drizzle voice session store and fake stores in tests.

## How To Add Another Use Case

Example: lien verification.

1. Add a new workflow definition id in `WorkflowDefinitionId`.
2. Add one or more step templates, for example `lienholder_follow_up`.
3. Export a new `WorkflowDefinition` from `src/modules/workflows/definitions.ts`.
4. Define required context. If lienholder context is not represented yet, add the smallest legal-context row/role needed.
5. Reuse `evaluateHumanReviewPolicy` if the same block rules apply, or compose a workflow-specific policy around it.
6. Implement `scheduleNextStep` for the use case.
7. Add the workflow id to creation/seed paths if it should be startable locally.
8. Teach the outbound callee resolver how to choose the lienholder for the new step type if it uses phone follow-up.
9. Add structured outcome fields only if the current `StructuredCallOutcome` is insufficient.
10. Add tests for definition registration, action routing, step execution, follow-up policy, and review behavior.

What should not change for a normal new use case:

- The Temporal workflow loop.
- The action router.
- The dashboard/read queries' core model.
- The review engine actions.
- Voice tool idempotency.
- The audit event table.
- The phone call terminal-status orchestration claim.

That is the main evidence that the platform is not narrowly built for the two assignment workflows.

## Key Tradeoffs and Alternatives

### Platform Slice Instead Of One-Off Automation

Chosen: build reusable workflow primitives.

Why: the assignment evaluates extensibility and abstraction, not whether one medical-records follow-up script is polished.

Not chosen: hard-code medical provider and client-check-in flows as separate code paths.

Why not: adding a third workflow would require copying scheduling, review, audit, and communication logic.

### Temporal Instead Of DB Queue Runner

Chosen: self-hosted Temporal.

Why: durable timers, signals, retries, recovery, and workflow history are core requirements for long-running agents.

Not chosen: keep pg-boss plus reconciliation.

Why not: the DB queue runner required custom polling, queue recovery, scheduling claims, and manual crash semantics.

### Postgres Projections Instead Of Temporal-Only State

Chosen: Postgres remains the product read model.

Why: workflow runs, steps, reviews, events, calls, and sessions must be queryable as domain data.

Not chosen: derive user-facing state directly from Temporal history.

Why not: that couples product reads to orchestration internals and makes reporting awkward.

### Real Phone Calls Instead Of Simulated Worker Calls

Chosen: real Twilio call placement for due follow-ups.

Why: it tests the platform against real callback and outcome flows.

Not chosen: synthetic worker responses.

Why not: it would hide the most important integration risks.

### Voice Agent As Adapter, Not Authority

Chosen: the voice agent requests structured tools.

Why: legal automation needs controlled, auditable actions.

Not chosen: give the voice agent broad mutation authority.

Why not: too risky and hard to audit.

### Deterministic Policy Over Learned Review Gates

Chosen: deterministic HITL policy.

Why: the reasons for blocking must be explainable and testable.

Not chosen: model-scored escalation only.

Why not: less predictable and harder to defend.

### Typed Code Definitions Before Workflow Builder

Chosen: TypeScript definitions.

Why: faster, safer, and testable for the first slice.

Not chosen: no-code workflow builder.

Why not: it would consume effort on authoring UX and DSL validation before the runtime primitives are settled.

## Failure and Recovery Semantics

Worker crash:

- Temporal replays workflow history and resumes timers or waits.

Duplicate due-step execution:

- `claimDueStep` atomically transitions `due` to `running`; duplicate attempts return `noop`.

Call placement failure:

- `recoverClaimedStep` returns the step to `due` until the retry limit is exhausted, then fails the step/run and appends `step.processing_failed`.

Outside calling window:

- autonomous calls defer to the next local business window and append `scheduling.decision`; attempt count does not increment.

Explicit requested follow-up:

- `requestedByUser` bypasses the business-hours snap for the attempt window.

Duplicate Twilio terminal callbacks:

- `phone_calls.orchestration_applied_at` is claimed once. Repeated callbacks do not duplicate scheduling decisions.

Duplicate LiveKit tool callbacks:

- unique voice session event index claims the `tool_call` once and returns the persisted `tool_result` on duplicates.

Open or assigned review:

- Temporal does not execute due steps while `openReviewId` exists.

Mid-load Temporal signal:

- workflow signal handlers set independent pending flags; the loop reloads state if a signal lands while the state snapshot is in flight.

## Current Limitations

- Authentication, firm tenancy, and role-based review permissions are not implemented.
- SMS, email, and provider portal adapters are stubbed or absent.
- LiveKit Cloud verification requires real credentials and manual testing.
- Twilio webhooks require a public `PUBLIC_BASE_URL`, usually a tunnel for local testing.
- Business-hour policy skips weekends but not US holidays.
- Review policy is deterministic and conservative, not an adaptive risk model.
- Seed data is intentionally for a fresh local database.
- Workflow code is not versioned for long-lived production migrations yet.
- Out-of-band database restore without Temporal history is out of scope.

## Implementation Map

Core workflow:

- `src/modules/workflows/types.ts`: shared workflow vocabulary and interfaces.
- `src/modules/workflows/definitions.ts`: registered workflow definitions.
- `src/modules/workflows/engine.ts`: controlled mutation engine.
- `src/modules/workflows/transitions.ts`: reusable transition helpers.
- `src/modules/workflows/execution.ts`: due-step execution.
- `src/modules/workflows/review-policy.ts`: HITL block rules.
- `src/modules/workflows/action-router.ts`: definition action allowlist.
- `src/modules/workflows/briefing.ts`: compact case/run briefing for voice agents.

Temporal:

- `src/temporal/config.ts`: runtime defaults.
- `src/temporal/client.ts`: Temporal client singleton and workflow id convention.
- `src/temporal/start-run.ts`: start and signal helpers.
- `src/temporal/worker.ts`: worker process.
- `src/temporal/workflows/workflow-run.ts`: durable workflow loop.
- `src/temporal/activities/runtime.ts`: testable activity factories.
- `src/temporal/activities/index.ts`: Drizzle/Twilio activity wiring.

Phone:

- `src/modules/phone/service.ts`: call placement, TwiML turns, terminal status handling.
- `src/modules/phone/orchestration.ts`: terminal call outcome to workflow decision.
- `src/modules/phone/follow-up-policy.ts`: scheduling policy.
- `src/modules/phone/store.ts`: phone call persistence and outbound context loading.
- `src/modules/phone/context.ts`: outbound call context assembly and timezone resolution.
- `src/modules/phone/conversation.ts`: briefing and conversation messages.
- `src/modules/phone/outcomes.ts`: transcript to structured outcome.
- `src/modules/phone/compliance.ts`: compliance flags.
- `src/modules/phone/status.ts`: Twilio status normalization.

Voice:

- `src/modules/livekit/token.ts`: room, participant, dispatch metadata, token launch.
- `src/modules/livekit/orchestration.ts`: validates workflow before launch.
- `src/modules/voice/store.ts`: voice sessions and event persistence.
- `src/voice-agent/agent.ts`: LiveKit worker and tools.
- `src/voice-agent/tools.ts`: conservative tool bridge into workflow actions and Temporal signals.
- `src/voice-agent/lifecycle.ts`: session lifecycle event persistence.

Case and read model:

- `src/modules/cases/update.ts`: input parsing and validation.
- `src/modules/cases/store.ts`: legal context creation and workflow start.
- `src/modules/dashboard/queries.ts`: read projections for operational surfaces.

Tests:

- Workflow definitions: `tests/workflow-definitions.test.ts`.
- Engine actions and reviews: `tests/workflow-actions.test.ts`.
- Due-step execution: `tests/execution-transitions.test.ts`.
- Follow-up policy: `tests/follow-up-policy.test.ts`.
- Phone orchestration: `tests/follow-up-orchestration.test.ts`.
- Temporal activities and workflow loop: `tests/temporal-activities.test.ts`, `tests/temporal-workflow-run.test.ts`.
- Voice tools and LiveKit lifecycle: `tests/voice-agent-tools.test.ts`, `tests/voice-agent-lifecycle.test.ts`, `tests/livekit-action.test.ts`.
- Timezone behavior: `tests/timezone.test.ts`.

