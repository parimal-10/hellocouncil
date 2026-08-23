# HelloCounsel Long-Running Agents Platform

A working slice of a reusable platform for long-running legal-agent workflows. It demonstrates durable workflow state, scheduled worker steps, human review, audit events, a LiveKit browser voice runtime, and a simulated voice-session fallback.

## Stack

- Next.js App Router
- TypeScript
- Postgres
- Drizzle
- pg-boss
- Vitest

## Local Setup

```powershell
npm install
Copy-Item .env.example .env
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Worker

Run the worker in a separate terminal:

```powershell
npm run worker
```

The worker requires the application environment to be configured and the Postgres database to be running.

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

LiveKit Cloud end-to-end verification requires those credentials and is a manual step: launch a session from `/voice`, permit browser microphone access, and confirm the agent worker joins the room. It is not covered by automated tests.

## Verification

```powershell
npm run test:run
npm run lint
npm run build
```

## Design Links

- [Platform design](docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md)
- [Assignment note](docs/assignment-note.md)
