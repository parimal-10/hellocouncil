# Long-Running Agents Platform Design

Date: 2026-08-23

## Goal

Build a working slice of a reusable platform for long-running legal-agent workflows. The slice is anchored on medical-records follow-up and client check-in, but the design must make a third workflow fit without rewriting the platform.

The platform does not build the voice agent runtime itself. It builds the framework around a voice agent: voice-session ingestion, structured tool routing, workflow state, human review, timers, retries, and audit history.

## Assignment Fit

The assignment asks for judgment under ambiguity, abstraction quality, extensibility, product thinking, and practical tradeoffs. This design optimizes for those criteria by exposing the primitives a firm would actually need:

- Workflow definitions for repeatable long-running use cases
- Workflow runs and durable steps
- Scheduled follow-ups and retries
- Human review requests when automation is blocked
- Append-only audit events
- A voice-session adapter seam for agent providers
- Controlled workflow actions instead of arbitrary agent mutation
- Lightweight legal context around cases, clients, providers, and firm users

## Product Slice

The first screen is an operations dashboard for a plaintiff firm team. It shows:

- Active workflow runs
- Blocked items needing human review
- Upcoming follow-ups
- Recent audit events
- Summary counts by workflow type and status

Seeded demo data will include:

- One medical-records follow-up workflow with a provider-facing follow-up step
- One client check-in workflow with a client update step
- Mixed states: running, due, waiting for human review, and recently completed events

The dashboard links into case/workflow detail views where the user can inspect the timeline, contact attempts, review requests, and simulated voice-session events.

## Technology Choices

### App Stack

Decision: Next.js App Router + TypeScript.

Alternatives considered:

1. Next.js App Router + TypeScript
   - Pros: one deployable app, colocated UI and server actions, strong TypeScript interfaces, good assignment velocity.
   - Cons: background workers run as a separate Node process.
   - Integration: `app/` owns dashboard and server actions; `src/modules/*` owns platform modules; `src/worker` owns due-step execution.

2. NestJS API + React/Vite
   - Pros: explicit backend module structure and dependency injection.
   - Cons: more boilerplate and two application surfaces for the assignment.
   - Integration: useful if the backend were much larger than the UI.

3. FastAPI + React
   - Pros: strong Python AI ecosystem.
   - Cons: weaker fit when the platform and UI are TypeScript-heavy and the voice runtime itself is not being built.
   - Integration: better if the scope included a custom voice-agent pipeline.

Selected because the assignment benefits from a cohesive app that can demonstrate platform primitives quickly.

### Persistence and Worker

Decision: Postgres + Drizzle + pg-boss.

Alternatives considered:

1. Postgres + Drizzle + pg-boss
   - Pros: production-shaped, one database for domain state and jobs, typed SQL-oriented schema, retries, delayed jobs, and worker coordination.
   - Cons: requires local Postgres.
   - Integration: Postgres stores workflow state and audit rows; pg-boss runs due steps and retryable work.

2. SQLite + custom polling worker
   - Pros: easiest to run locally.
   - Cons: weaker concurrency and durability story.
   - Integration: acceptable for a prototype, but less credible as a platform slice.

3. Postgres + Prisma + custom worker
   - Pros: familiar ORM.
   - Cons: job semantics still need to be built.
   - Integration: workable, but Drizzle keeps the SQL model more visible.

Selected because the platform's core value is durable state, scheduling, and auditability.

### Future Orchestration Path

Decision: use the DB-backed workflow engine for this slice and document Temporal as the production migration path.

Temporal was considered the strongest production-grade durable workflow engine because it provides durable execution, timers, signals, retries, event history, and resumability. It is heavier than needed for this assignment and could obscure the platform primitives behind a vendor integration. The domain model will keep workflow runs, steps, timers, review requests, and audit events explicit so a future Temporal migration can map those concepts to workflows, activities, signals, and queries.

### Voice Framework

Decision: simulated streaming voice session plus a provider interface.

Alternatives considered:

1. Simulated streaming voice session + provider interface
   - Pros: proves the framework around voice agents, deterministic tests, no credentials required.
   - Cons: not real audio.
   - Integration: `VoiceSessionAdapter` emits transcript and structured tool-call events into the platform.

2. LiveKit Agents + OpenAI Realtime skeleton
   - Pros: closest to production voice sessions, with WebRTC, VAD, interruption, and provider integration.
   - Cons: may not run without credentials and setup; can distract from the framework.
   - Integration: production adapter target.

3. Direct browser microphone prototype
   - Pros: visible demo.
   - Cons: spends effort on a runtime the slice intentionally does not need.
   - Integration: not selected.

Production recommendation: LiveKit Agents with OpenAI Realtime or an STT/LLM/TTS pipeline. LiveKit gives the platform room for WebRTC sessions, VAD/turn detection, interruptions, telephony, provider swaps, and observability.

## Core Modules

### WorkflowDefinition

Interface:

- Workflow metadata: id, label, description, legal context requirements
- Step templates: step type, default schedule, retry policy, allowed actions
- Schedule policy: how the next step is computed
- Human review policy: block rules for this workflow
- Allowed agent actions: structured actions the voice/tool layer can request

Implementation:

- `medicalRecordsFollowUpDefinition`
- `clientCheckInDefinition`

Depth:

Callers learn one definition shape. New workflows plug in by exporting another definition object, not by modifying the engine.

### WorkflowEngine

Interface:

- Start a workflow run from a definition and legal context
- Advance a due step
- Apply a controlled workflow action
- Schedule the next step
- Record an audit event
- Create or resolve human review requests

Implementation:

- Validates transitions
- Updates current-state tables
- Appends workflow events
- Enqueues delayed work through pg-boss
- Calls the human review policy before completing automation

Depth:

The engine hides state transitions, audit writes, and scheduling. UI actions, worker jobs, and voice tool calls all cross the same interface.

### HumanReviewPolicy

Interface:

- Evaluate a candidate workflow update and return either `allow` or `block`
- Block result includes reason, severity, recommended reviewer action, and generated review request payload

Policy blocks:

- Missing authorization
- Ambiguous client response
- Medical provider refusal
- Sensitive or legal-advice-seeking content
- Failed contact attempt threshold

Depth:

The policy centralizes judgment rules so workflow definitions and the voice router do not scatter human-in-loop logic.

### VoiceSessionAdapter

Interface:

- Start a voice session against a case or workflow run
- Emit transcript chunks
- Emit structured tool calls
- End a session with summary metadata

Implementation for the slice:

- A simulated stream that replays transcript chunks and tool calls from demo scripts.

Production adapter:

- LiveKit Agents + OpenAI Realtime adapter that maps provider events into the same transcript/tool-call events.

Depth:

The rest of the platform does not know whether events came from a simulated stream, a browser session, a phone call, or a LiveKit room.

### WorkflowActionRouter

Interface:

- Accept a structured tool call from a voice session
- Validate that the workflow definition allows the action
- Map it to a workflow engine operation
- Return a result for the voice agent/session timeline

Allowed actions:

- Create workflow update
- Request human review
- Mark contact attempt
- Schedule follow-up
- Resolve blocked step

Depth:

The voice layer never mutates arbitrary workflow state. Every action goes through a controlled platform primitive.

### AuditEventLog

Interface:

- Append a typed event
- Query recent events for a workflow run or dashboard

Implementation:

- Append-only `workflow_events` table
- Current-state tables optimized for dashboard reads

Depth:

The platform gets traceability without making every query rebuild state from scratch.

## Data Model

Lightweight legal context:

- `cases`: matter name, status, assigned firm user
- `people`: clients, firm users, provider contacts
- `organizations`: medical providers and law firm
- `case_participants`: role mapping between cases, people, and organizations

Workflow state:

- `workflow_definitions`: registered definition metadata
- `workflow_runs`: current run state, workflow type, case id, status, started/updated timestamps
- `workflow_steps`: durable units with status, due time, attempt count, and payload
- `workflow_events`: append-only audit events
- `human_review_requests`: blocked or reviewable items with status and reviewer actions
- `contact_attempts`: stubbed external communications and synthetic responses
- `voice_sessions`: session metadata and provider id
- `voice_session_events`: transcript chunks, tool calls, tool results

Status vocabulary:

- Workflow run: `active`, `waiting_for_human`, `completed`, `failed`, `cancelled`
- Workflow step: `pending`, `due`, `running`, `waiting_for_human`, `completed`, `failed`, `skipped`
- Review request: `open`, `approved`, `edited`, `rejected`, `assigned`, `resolved`

## Worker Behavior

The worker executes due steps only. It does not run an open-ended autonomous planning loop.

Loop:

1. Claim due workflow step through pg-boss.
2. Load workflow run, step, definition, and legal context.
3. Record a contact attempt for the step.
4. Generate or load a synthetic response.
5. Evaluate the human review policy.
6. If blocked, mark step and run as waiting for human and create a review request.
7. If allowed, record update, complete the step, and schedule the next step.
8. Append workflow events for every transition.

This demonstrates timers, retries, resumability, blocked automation, and auditability without pretending to solve full autonomy.

## Human Review Flow

The review queue supports controlled actions:

- Approve
- Edit
- Reject
- Assign owner
- Resolve blocked step
- Add note

Every review action appends an audit event. If the action unblocks the run, the workflow engine schedules the next step through pg-boss.

## UI Surfaces

### Operations Dashboard

Shows:

- Active workflow runs
- Blocked review requests
- Upcoming due steps
- Recent audit events
- Counts by workflow type and status

### Workflow Detail

Shows:

- Case context
- Workflow status
- Steps and due dates
- Contact attempts
- Human review requests
- Audit event timeline
- Voice-session transcript/tool-call timeline

### Review Queue

Shows:

- Open review requests
- Block reason and evidence
- Recommended action
- Reviewer controls

### Voice Session Console

Shows:

- Simulated transcript stream
- Structured tool calls
- Tool results
- Linked workflow events

## Testing Strategy

Required before calling the slice complete:

- Unit tests for workflow definitions
- Unit tests for human review policy
- Unit tests for voice tool routing
- Integration tests for worker transitions:
  - due step completes and schedules next step
  - blocked response creates human review request
  - review resolution unblocks and schedules follow-up
- Build and lint checks

Browser end-to-end tests are optional if time remains.

## Implemented vs Stubbed

Implemented:

- Dashboard and detail views
- Typed workflow definitions
- DB-backed workflow state
- Append-only audit events
- pg-boss due-step worker
- Human review queue and controlled review actions
- Simulated voice-session adapter
- Structured tool-call routing
- Seeded demo cases and workflow runs
- Assignment explanation note

Stubbed:

- Real phone calls, SMS, email, and provider portals
- Real voice-agent runtime
- Real LiveKit/OpenAI credentials and session creation
- Authentication and firm tenancy
- Production observability
- Document ingestion and medical-record file parsing

## Where the System Breaks Down Today

- The simulated voice session proves the seam, not real audio latency or barge-in behavior.
- Synthetic provider/client responses cannot validate real-world communication variance.
- A DB-backed worker is enough for the slice, but complex multi-month workflows may need Temporal or a similar durable orchestration engine.
- No tenant isolation or authorization model is included.
- HITL rules are deterministic policies, not learned risk scoring.
- The current data model is a platform slice, not a full plaintiff-firm case-management system.

## Adding a New Use Case

To add a new workflow:

1. Define a new `WorkflowDefinition` object with metadata, step templates, schedule policy, HITL policy, and allowed actions.
2. Add seed data or UI creation path for starting the run against a case.
3. Implement any synthetic response fixtures needed by the worker.
4. Add tests for the definition, policy behavior, and worker transition.
5. The dashboard, audit timeline, review queue, and voice tool router should work without new platform code.

Example future workflow: lien verification.

- Step 1: contact lienholder or internal user for lien status.
- Step 2: wait for response or schedule follow-up.
- Step 3: block for human review if amount is disputed, missing authorization, or contradictory.
- Step 4: record final status and next action.

## Next Steps With More Time

1. Replace simulated voice sessions with LiveKit Agents + OpenAI Realtime.
2. Add authentication, firm tenancy, and role-based review permissions.
3. Integrate real SMS/email/phone adapters behind a communication seam.
4. Add Temporal for production-grade long-lived workflows if workflows become more complex.
5. Add observability: worker metrics, stuck-step alerts, review SLA reporting.
6. Add a workflow creation UI once the typed definition model proves stable.

## Decision Log

1. Reusable platform slice over voice demo: chosen because the assignment evaluates platform primitives and extensibility.
2. Framework around voice agent, not agent runtime: chosen because the user clarified the agent itself is out of scope.
3. Next.js App Router + TypeScript: chosen for a cohesive app with strong UI/backend velocity.
4. Postgres + Drizzle + pg-boss: chosen to make durable state, jobs, retries, and auditability explicit.
5. DB-backed worker over Temporal for the slice: chosen to keep platform primitives visible; Temporal remains the production migration path.
6. Simulated voice adapter: chosen to test tool routing and audit behavior without credentials or real-time media setup.
7. Typed workflow definitions: chosen to make new use cases plug into the platform through a small interface.
8. Structured voice tool calls: chosen to prevent arbitrary agent mutation of workflow state.
9. Lightweight legal context: chosen to make workflows credible without building a full CRM.
10. Stubbed external comms: chosen because the assignment is about long-running workflow primitives, not telecom/email integration.
11. Append-only events plus current-state tables: chosen for auditability and practical dashboard reads.
12. Due-step worker: chosen to demonstrate long-running behavior without an unbounded autonomous loop.
13. Controlled review actions: chosen to keep HITL useful and auditable.
14. Seed data: chosen so reviewers see the platform behavior immediately.
15. Required unit/integration/build/lint verification: chosen to cover the platform logic at reasonable cost.

## Primary References

- Assignment: `Long running agents platform - assignment.txt`
- LiveKit Agents docs: https://docs.livekit.io/agents/
- LiveKit turn detection and interruption docs: https://docs.livekit.io/agents/logic/turns/
- OpenAI Realtime API docs: https://platform.openai.com/docs/api-reference/realtime
- Next.js App Router docs: https://nextjs.org/docs/app
- Drizzle PostgreSQL docs: https://orm.drizzle.team/docs/get-started/postgresql-new
- pg-boss docs: https://pgboss.io/
- Temporal docs: https://docs.temporal.io/
