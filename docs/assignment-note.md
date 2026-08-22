# Long-Running Agents Platform Note

## Design Chosen

This slice implements a reusable platform around long-running legal-agent workflows. The voice agent runtime is outside the scope of the slice; the platform provides the framework around it: voice-session ingestion, structured tool routing, durable workflow state, human review, timers, retries, and audit events.

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
- Medical-records follow-up definition
- Client check-in definition
- DB-backed workflow state
- pg-boss worker entrypoint
- HITL policy
- Seeded demo data

The worker uses app-DB scheduling claims as the scheduling and state authority, with a pg-boss producer used to enqueue claimed work. pg-boss is therefore a queueing mechanism in the current architecture, not the authority for workflow scheduling or state.

## Stubbed

- Real voice-agent runtime
- LiveKit/OpenAI session creation
- Phone, SMS, email, and provider portal integrations
- Authentication and firm tenancy
- Production observability

## Where It Breaks Down Today

The simulated voice session proves the provider seam and tool-routing contract, but it does not validate real audio latency, VAD, or interruption behavior. Synthetic communication responses cannot capture the variance of medical providers or client conversations.

The DB-backed worker is appropriate for this slice. Temporal is the production migration path if workflow branching, retries, and multi-month duration outgrow the current runner. The domain primitives remain explicit so they can map to Temporal workflows, activities, signals, and queries later.

## Adding a New Use Case

Add a new `WorkflowDefinition` with metadata, step templates, schedule policy, review policy, and allowed actions. Add seed data or a creation path, then add synthetic responses for the worker. The dashboard, review queue, audit timeline, and voice action router should not require workflow-specific changes.

For example, a lien verification workflow could define a lienholder follow-up step, block on disputed amounts or missing authorization, and complete when the lien status is confirmed.

## What to Build Next

1. Replace the simulated voice adapter with LiveKit Agents + OpenAI Realtime.
2. Add authentication, firm tenancy, and role-based review permissions.
3. Add real communication adapters behind a communication seam.
4. Add worker observability and stuck-step alerts.
5. Move to Temporal if workflow branching and duration outgrow the DB-backed runner.
