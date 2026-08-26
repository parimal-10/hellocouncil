# Long-Running Agents Platform — Reviewer Note

A working slice of a reusable platform for long-running legal-agent workflows: durable workflow state, scheduled follow-ups that place **real Twilio calls**, human-in-the-loop review, an append-only audit trail, and both a browser voice runtime (LiveKit) and an autonomous phone agent — all driven by one workflow engine.

---

## The Core Idea

The platform is not two workflows. It is **one engine plus data**. Medical-records follow-up and client check-in are just definition objects plugged into it:

```ts
WorkflowDefinition = {
  stepTemplates,        // what to do, how often, retry limits
  scheduleNextStep(),   // when the next outreach happens (or null = done)
  reviewPolicy(),       // when automation must stop for a human
  allowedActions,       // what agents may do on this workflow
}
```

Adding a third use case (e.g., lien verification) means exporting one more object. No engine changes. Dashboard, review queue, audit timeline, worker, and voice tools work unchanged.



## Architecture

```
Browser UI ──► Next.js server actions
                     │
              WorkflowEngine          ← single gateway for ALL mutations
               │           │             (validate → mutate → audit → schedule)
        Postgres         pg-boss queue
      (state authority)  (delivery only)
               │
        Worker (60s reconcile loop + job runner)
               │
     ┌─────────┴──────────────┐
  Twilio phone calls    LiveKit voice sessions
  (autonomous dialing,  (browser mic → STT → LLM
   LLM conversation,     → structured tools → TTS)
   outcome extraction)
```

Three processes: the Next.js app, a pg-boss worker (`npm run worker`), and a LiveKit agent worker (`npm run voice:agent`).

Key structural rule: **agents never mutate workflow state directly.** Voice tools and workers emit six typed structured actions (`create_update`, `request_review`, `mark_contact_attempt`, `schedule_follow_up`, `resolve_blocked_step`, `add_review_note`) through one router into one engine. Approve/reject/resolve are deliberately **human-only** — the voice agent has no tool for them.

## The Primitives

| Primitive | What it gives |
|---|---|
| Workflow definitions | New use cases plug in as data |
| Durable runs & steps | State survives restarts; timers in hours/days/weeks |
| Scheduling policy (`follow-up-v1`) | Timezone-correct business hours, retry ladders, urgency handling — every decision logged with its reason, not just its timestamp |
| Human review requests | Automation blocks itself on missing authorization, refusals, ambiguity, legal-advice seeking, or 3 failed contacts; reviewers approve/edit/reject/assign/note |
| Append-only event log | Full audit trail alongside cheap current-state tables |
| Voice session adapter seam | Phone calls and browser sessions converge into the same engine; the platform can't tell (or care) which channel spoke |

## Decisions Worth Defending

1. **Postgres owns truth; pg-boss only delivers.** A lost queue row can never lose a follow-up. Steps live as queryable rows; a 60s reconciliation loop re-enqueues anything the queue dropped. Claims are atomic compare-and-swap updates, so duplicate deliveries and double execution are structurally impossible.
2. **Real integrations where it matters, loud failures elsewhere.** Due follow-ups place real Twilio calls and refuse to run without a configured phone runtime — no silent simulation of "we called the client."
3. **Centralized HITL policy.** One deterministic function decides allow/block for every channel, so human-in-the-loop logic isn't scattered across routers and definitions.
4. **Auditable scheduling.** Every defer/retry/schedule decision writes a `scheduling.decision` event carrying policy id, reason, due time, and metadata.
5. **Framework around the voice agent, not the agent itself.** The runtime (LiveKit pipeline, Twilio media) is swappable; session ingestion, tool routing, and persistence stay generic.

> 📸 *[Screenshot: Workflow detail view — timeline with call outcomes and scheduling decisions — `/workflows/{id}`]*
>
> 📸 *[Screenshot: Review queue with block reason and reviewer controls — `/review`]*

## What's Implemented vs. Stubbed

**Implemented:** operations dashboard · workflow detail + audit timeline · review queue with distinct assign/approve/edit/reject/resolve/note actions · autonomous Twilio outbound calling with LLM conversations and structured outcome extraction · LiveKit browser voice runtime with idempotent tool-call claiming · retry-limited step recovery · timezone-aware scheduling policy · seeded demo data · case creation with immediate workflow start.

**Stubbed:** SMS/email/provider portals · authentication and firm tenancy · production observability.

## Known Gaps

- No tenant isolation or role-based review permissions yet.
- Calling window skips weekends but not US holidays.
- HITL rules are deterministic policies, not learned risk scoring.
- LiveKit Cloud end-to-end verification is manual (not covered by automated tests); local Twilio webhooks need a public tunnel.

## Planned Change: DB-Backed Runner → Temporal

The current DB-backed runner (Postgres as state authority + reconciliation) was chosen so the platform primitives stay visible and testable at this scale. It will be **replaced by Temporal** as the workflow orchestrator: runs map to Temporal workflows, steps to activities and timers, review resolution to signals, and status reads to queries. The domain model was deliberately kept explicit so this is a runner swap, not a redesign — definitions, policies, review flow, voice tools, and the audit model carry over unchanged.

> 📸 *[Optional screenshot: Case directory `/cases` or new-case form `/cases/new` showing workflow start]*
