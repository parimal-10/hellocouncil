# HelloCounsel Long-Running Agents Platform

A working slice of a reusable platform for long-running legal-agent workflows. It demonstrates durable workflow state, scheduled worker steps, human review, audit events, and a simulated voice-session boundary.

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

## Verification

```powershell
npm run test:run
npm run lint
npm run build
```

## Design Links

- [Platform design](docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md)
- [Assignment note](docs/assignment-note.md)
