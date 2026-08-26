# HelloCounsel Long-Running Agents Platform

A working slice of a reusable platform for long-running legal-agent workflows. It demonstrates durable workflow state, scheduled worker steps, human review, audit events, a LiveKit browser voice runtime, and a simulated voice-session fallback.

## Stack

- Next.js App Router
- TypeScript
- Postgres
- Drizzle
- Temporal (self-hosted)
- Vitest

## Local Setup

Prerequisite: Docker (for Postgres and the Temporal server).

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`docker compose up -d` starts four services:

- `postgres` — application and Temporal persistence (`localhost:5432`)
- `temporal` — Temporal server (`temporalio/auto-setup`, `localhost:7233`)
- `temporal-ui` — Temporal Web UI at `http://localhost:8080`
- `temporal-namespace-init` — one-shot job that creates the `hellocouncil` namespace (retries until the server is ready)

Open `http://localhost:3000`.

### Public webhook URL for local Twilio calls

Real Twilio calls need to reach your local Next.js webhooks, so expose local port
`3000` through a public tunnel and set that URL in `.env`:

```powershell
ngrok http 3000
```

Copy the generated HTTPS forwarding URL, for example
`https://abc123.ngrok-free.app`, into:

```text
PUBLIC_BASE_URL=https://abc123.ngrok-free.app
```

Any equivalent tunnel provider is fine. The important part is that
`PUBLIC_BASE_URL` points to the public HTTPS URL that forwards to your local
`http://localhost:3000` app. Restart `npm run dev` and `npm run worker` after
changing `.env`.

## Worker

Run the worker in a separate terminal:

```powershell
npm run worker
```

The worker (`src/temporal/worker.ts`) connects to the Temporal server at `TEMPORAL_ADDRESS` (default `localhost:7233`) in namespace `TEMPORAL_NAMESPACE` (default `hellocouncil`) and polls the task queue `hellocouncil-workflows`.

The worker requires the application environment to be configured and both Postgres and the Temporal server to be running. Set `AUTO_OUTBOUND_CALLS=true` (with the `TWILIO_*` variables and `PUBLIC_BASE_URL`) so due follow-up steps place real Twilio calls; there is no simulated fallback, and the worker refuses to start without it.

### Workflow conventions

- One Temporal workflow execution per workflow run, with workflow id `workflow-run-${workflowRunId}`.
- Signals: `callCompleted {callId}`, `reviewResolved`, `runFollowUpNow`, `scheduleFollowUp`.
- Query: `runState`.
- Durable timers, retries, and recovery after restarts are owned by Temporal. Postgres holds current-state projections (runs, steps, events) for UI reads.

Dev-only caveat: workflow code is not versioned. Changing workflow code can break in-flight executions — re-seed or cancel running workflows after modifying workflow logic.

Note: real Twilio dialing requires a full Twilio account and a public tunnel so status webhooks can reach `PUBLIC_BASE_URL`.

## LiveKit Voice Agent

This phase uses LiveKit Cloud and LiveKit Inference only. Do not configure direct third-party model-provider keys for the first LiveKit runtime.

Required environment variables:

```text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_INFERENCE_API_KEY=
LIVEKIT_AGENT_NAME=hellocouncil-agent
LIVEKIT_STT_MODEL=deepgram/nova-3
LIVEKIT_LLM_MODEL=openai/gpt-4.1-mini
LIVEKIT_TTS_MODEL=cartesia/sonic-3
LIVEKIT_TTS_VOICE=9626c31c-bec5-4cca-baa8-f8ba9e84c8bc
```

Run the app and agent in separate terminals:

```powershell
npm run dev
npm run voice:agent
```

Apply migrations before starting either process. Each browser launch now creates a unique
LiveKit room and participant identity, and the explicit dispatch carries the persisted voice
session id used by the worker before it connects. The worker records `session.started`,
participant connection, transcript chunks, conversation messages, errors, and a final
completed/failed event with an ended reason. Repeated SDK tool callbacks are claimed by voice
session and tool-call id before workflow mutation.

LiveKit Cloud end-to-end verification requires those credentials and is a manual step: launch a session from `/voice`, permit browser microphone access, and confirm the agent worker joins the room. It is not covered by automated tests.

## Verification

```powershell
npm run test:run
npm run lint
npm run build
```

## Creating a Case

Open `/cases`, fill in the matter, client, and optional provider contacts, and optionally pick a workflow. Saving the case creates the legal context and, when a workflow is selected, starts the run with its first follow-up step due immediately — the worker then places the outbound call autonomously and records the conversation outcome on the workflow timeline.

## Design Links

- [Platform design](docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md)
- [Temporal runner migration design](docs/superpowers/specs/2026-08-26-temporal-runner-migration-design.md)
- [Assignment note](docs/assignment-note.md)
