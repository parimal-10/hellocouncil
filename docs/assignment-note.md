# Long-Running Agents Platform Note

## Design Chosen

This slice implements a reusable platform around long-running legal-agent workflows. It includes a LiveKit browser voice runtime backed by a separate LiveKit Agents Node worker, alongside the simulated voice-session fallback. This phase uses LiveKit Cloud and LiveKit Inference only; it does not configure direct third-party model-provider credentials.

The reusable platform/framework approach was chosen because the durable workflow primitives, review controls, audit trail, and provider seams are shared across legal-agent use cases. Keeping those concerns generic lets new workflows vary through definitions and policies instead of duplicating operational infrastructure, while preserving a clear migration path to a production voice runtime and, if needed, Temporal.

## Product and Platform Primitives

- Workflow definitions
- Workflow runs
- Durable workflow steps
- Human review requests
- Contact attempts
- Append-only workflow events
- Simulated voice sessions
- Structured workflow actions
- Lightweight legal context for cases, people, and organizations

## Implemented

- Operations dashboard
- Workflow detail view
- Review queue
- Simulated voice session console
- LiveKit browser voice runtime with microphone transport
- Medical-records follow-up definition
- Client check-in definition
- DB-backed workflow state
- pg-boss worker entrypoint
- Retryable claimed-step recovery with retry-limit enforcement
- HITL policy
- Distinct assign, approve, edit, reject, resolve, and note-only review actions
- Persisted simulated voice lifecycle, transcripts, tool calls, and tool results
- Persisted LiveKit room, participant, and dispatch metadata
- Seeded demo data

The worker uses app-DB scheduling claims as the scheduling and state authority, with a pg-boss producer used to enqueue claimed work. pg-boss is therefore a queueing mechanism in the current architecture, not the authority for workflow scheduling or state.

## Stubbed

- Twilio phone calls
- SMS, email, and provider portal integrations
- Authentication and firm tenancy
- Production observability

## Where It Breaks Down Today

The LiveKit browser runtime requires a credentialed LiveKit Cloud environment and must be verified manually; it is not exercised by automated Cloud E2E tests. The simulated voice session remains the deterministic fallback and does not validate real audio latency, VAD, or interruption behavior. Synthetic communication responses cannot capture the variance of medical providers or client conversations.

The DB-backed worker is appropriate for this slice. Temporal is the production migration path if workflow branching, retries, and multi-month duration outgrow the current runner. The domain primitives remain explicit so they can map to Temporal workflows, activities, signals, and queries later.

The demo seed is intentionally non-idempotent and should be run against a fresh local database. Production-grade seed reconciliation remains outside this assignment slice.

## Adding a New Use Case

Add a new `WorkflowDefinition` with metadata, step templates, schedule policy, review policy, and allowed actions. Add seed data or a creation path, then add synthetic responses for the worker. The dashboard, review queue, audit timeline, and voice action router should not require workflow-specific changes.

For example, a lien verification workflow could define a lienholder follow-up step, block on disputed amounts or missing authorization, and complete when the lien status is confirmed.

## What to Build Next

1. Migrate from the deprecated upstream `@livekit/agents-plugin-livekit` multilingual text turn detector when the LiveKit SDK provides its replacement.
2. Add authentication, firm tenancy, and role-based review permissions.
3. Add real communication adapters, including Twilio phone calls, behind a communication seam.
4. Add worker observability and stuck-step alerts.
5. Move to Temporal if workflow branching and duration outgrow the DB-backed runner.
