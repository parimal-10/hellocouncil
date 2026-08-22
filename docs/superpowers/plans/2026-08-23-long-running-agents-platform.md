# Long-Running Agents Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Next.js slice of a reusable platform for long-running legal-agent workflows with durable workflow state, human review, audit events, and a simulated voice-session framework.

**Architecture:** The app is organized around deep modules: workflow definitions, human review policy, workflow action routing, workflow engine, worker runner, and UI query modules. Postgres stores canonical state and audit events; pg-boss runs due-step jobs; the simulated voice adapter emits transcript and structured tool-call events into the same workflow action interface a production LiveKit/OpenAI adapter would use.

**Tech Stack:** Next.js App Router, TypeScript, React, Drizzle ORM, Postgres, pg-boss, Vitest, Testing Library, Tailwind CSS, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md`

## Global Constraints

- Build the framework around a voice agent, not the voice agent runtime itself.
- Use Next.js App Router + TypeScript.
- Use Postgres + Drizzle + pg-boss for durable state and due-step execution.
- Keep workflow events append-only and maintain current-state tables for dashboard reads.
- Ship typed workflow definitions for medical-records follow-up and client check-in.
- Route voice events through structured tool calls only; do not allow arbitrary workflow mutation.
- Human review blocks: missing authorization, ambiguous client response, medical provider refusal, sensitive/legal advice, failed contact attempts.
- External communications are stubbed as contact attempts and synthetic responses.
- Seed two demo cases and mixed workflow states.
- Required verification: unit tests for workflow definitions, policy, and tool routing; integration tests for worker transitions; build and lint checks.
- The repo may not be a git repo. If `git status` fails, skip commit steps and note that explicitly.

---

## File Structure

Create or modify these files:

- `package.json`: scripts and dependencies.
- `tsconfig.json`: TypeScript config with `@/*` path alias.
- `next.config.ts`: Next config.
- `postcss.config.mjs`: Tailwind/PostCSS config.
- `tailwind.config.ts`: Tailwind content/theme config.
- `vitest.config.ts`: Vitest config.
- `vitest.setup.ts`: test setup.
- `.env.example`: required local env variables.
- `docker-compose.yml`: local Postgres service.
- `drizzle.config.ts`: Drizzle migration config.
- `src/db/schema.ts`: Drizzle table definitions.
- `src/db/client.ts`: Drizzle client.
- `src/db/seed.ts`: seeded demo data.
- `src/modules/workflows/types.ts`: shared workflow interfaces and discriminated unions.
- `src/modules/workflows/definitions.ts`: medical-records and client-check-in definitions.
- `src/modules/workflows/review-policy.ts`: HITL policy.
- `src/modules/workflows/action-router.ts`: voice/tool action router.
- `src/modules/workflows/engine.ts`: workflow engine.
- `src/modules/workflows/store.ts`: DB-backed store interface and Drizzle implementation.
- `src/modules/workflows/synthetic-responses.ts`: deterministic communication responses.
- `src/modules/voice/types.ts`: voice session event types.
- `src/modules/voice/simulated-adapter.ts`: simulated streaming adapter.
- `src/modules/dashboard/queries.ts`: dashboard read model.
- `src/worker/boss.ts`: pg-boss connection and job names.
- `src/worker/run-due-step.ts`: due-step job implementation.
- `src/worker/start.ts`: worker entrypoint.
- `app/globals.css`: global styles.
- `app/layout.tsx`: app shell.
- `app/page.tsx`: operations dashboard.
- `app/workflows/[id]/page.tsx`: workflow detail.
- `app/review/page.tsx`: review queue.
- `app/voice/page.tsx`: simulated voice session console.
- `app/actions/review.ts`: review server actions.
- `app/actions/voice.ts`: simulated voice server actions.
- `docs/assignment-note.md`: deliverable explanation.
- `tests/workflow-definitions.test.ts`: definition tests.
- `tests/review-policy.test.ts`: HITL policy tests.
- `tests/action-router.test.ts`: tool routing tests.
- `tests/worker-transitions.test.ts`: worker transition integration tests.
- `tests/test-store.ts`: in-memory store for module integration tests.

---

### Task 1: Project Scaffold and Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `tailwind.config.ts`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `app/globals.css`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `tests/scaffold.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `lint`, `test`, `test:run`, `db:generate`, `db:migrate`, `db:seed`, `worker`.
- Produces: TypeScript path alias `@/*` for files under `src/*`.
- Produces: a runnable Next.js shell that later tasks can replace with real data.

- [ ] **Step 1: Create the package manifest**

Create `package.json`:

```json
{
  "name": "hellocouncil-long-running-agents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint .",
    "test": "vitest",
    "test:run": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts",
    "worker": "tsx src/worker/start.ts"
  },
  "dependencies": {
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.45.0",
    "lucide-react": "^0.468.0",
    "next": "^15.1.0",
    "pg": "^8.13.0",
    "pg-boss": "^12.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.6.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.31.0",
    "eslint": "^9.17.0",
    "eslint-config-next": "^15.1.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create TypeScript and framework config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

export default nextConfig;
```

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
```

Create `tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18202f",
        muted: "#5f6b7a",
        line: "#d9dee7",
        panel: "#f7f8fb",
        accent: "#0f766e",
        warning: "#b45309",
        danger: "#b91c1c",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Create Vitest setup**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});
```

Create `vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `tests/scaffold.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("runs the test harness", () => {
    expect("hellocouncil").toContain("council");
  });
});
```

- [ ] **Step 4: Create environment and Postgres config**

Create `.env.example`:

```text
DATABASE_URL=postgres://postgres:postgres@localhost:5432/hellocouncil
PG_BOSS_SCHEMA=pgboss
```

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hellocouncil
    ports:
      - "5432:5432"
    volumes:
      - hellocouncil-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d hellocouncil"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  hellocouncil-postgres:
```

- [ ] **Step 5: Create a minimal app shell**

Create `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color: #18202f;
  background: #f7f8fb;
}

body {
  margin: 0;
  min-height: 100vh;
  font-family: Arial, Helvetica, sans-serif;
}

a {
  color: inherit;
  text-decoration: none;
}
```

Create `app/layout.tsx`:

```tsx
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "HelloCounsel Agent Operations",
  description: "Long-running legal-agent workflow operations",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-panel text-ink">
          <header className="border-b border-line bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-lg font-semibold">
                HelloCounsel Agent Ops
              </Link>
              <nav className="flex gap-4 text-sm text-muted">
                <Link href="/">Dashboard</Link>
                <Link href="/review">Review</Link>
                <Link href="/voice">Voice</Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

Create `app/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Operations dashboard</h1>
        <p className="text-sm text-muted">
          Workflow runs, blocked review items, upcoming follow-ups, and recent events will appear here.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies install and `package-lock.json` is created.

- [ ] **Step 7: Verify scaffold**

Run:

```powershell
npm run test:run -- tests/scaffold.test.ts
npm run build
```

Expected: the scaffold test passes and the Next.js build completes.

- [ ] **Step 8: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs tailwind.config.ts vitest.config.ts vitest.setup.ts .env.example docker-compose.yml app tests
git commit -m "chore: scaffold long-running agents app"
```

If `git status` says this is not a git repository, skip the commit and record that in the task summary.

---

### Task 2: Workflow Types, Definitions, HITL Policy, and Action Router

**Files:**
- Create: `src/modules/workflows/types.ts`
- Create: `src/modules/workflows/definitions.ts`
- Create: `src/modules/workflows/review-policy.ts`
- Create: `src/modules/workflows/action-router.ts`
- Create: `src/modules/voice/types.ts`
- Create: `tests/workflow-definitions.test.ts`
- Create: `tests/review-policy.test.ts`
- Create: `tests/action-router.test.ts`

**Interfaces:**
- Produces: `WorkflowDefinition`, `WorkflowAction`, `ReviewDecision`, `WorkflowActionRouter`.
- Consumes: no database. These are pure modules.
- Later tasks rely on exported definition ids: `medical-records-follow-up`, `client-check-in`.

- [ ] **Step 1: Write failing workflow definition tests**

Create `tests/workflow-definitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { workflowDefinitions } from "@/modules/workflows/definitions";

describe("workflow definitions", () => {
  it("registers the two assignment workflows", () => {
    expect(workflowDefinitions.map((definition) => definition.id)).toEqual([
      "medical-records-follow-up",
      "client-check-in",
    ]);
  });

  it("keeps every workflow behind the same small interface", () => {
    for (const definition of workflowDefinitions) {
      expect(definition.stepTemplates.length).toBeGreaterThan(0);
      expect(definition.allowedActions).toContain("create_update");
      expect(typeof definition.scheduleNextStep).toBe("function");
      expect(typeof definition.reviewPolicy).toBe("function");
    }
  });
});
```

Run:

```powershell
npm run test:run -- tests/workflow-definitions.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 2: Create shared workflow and voice types**

Create `src/modules/workflows/types.ts`:

```ts
export type WorkflowDefinitionId = "medical-records-follow-up" | "client-check-in";

export type WorkflowRunStatus = "active" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type WorkflowStepStatus = "pending" | "due" | "running" | "waiting_for_human" | "completed" | "failed" | "skipped";
export type ReviewRequestStatus = "open" | "approved" | "edited" | "rejected" | "assigned" | "resolved";

export type WorkflowActionType =
  | "create_update"
  | "request_review"
  | "mark_contact_attempt"
  | "schedule_follow_up"
  | "resolve_blocked_step";

export type ContactChannel = "phone" | "sms" | "email" | "portal" | "voice_session";

export type LegalContext = {
  caseId: string;
  caseName: string;
  clientName: string;
  providerName?: string;
  assignedUserName: string;
};

export type WorkflowStepTemplate = {
  type: string;
  label: string;
  defaultDueInHours: number;
  retryLimit: number;
};

export type WorkflowSignal = {
  text: string;
  channel: ContactChannel;
  attemptCount: number;
  hasAuthorization: boolean;
  actorRole: "client" | "provider" | "firm_user" | "voice_agent";
};

export type ReviewBlockReason =
  | "missing_authorization"
  | "ambiguous_client_response"
  | "provider_refusal"
  | "sensitive_legal_advice"
  | "failed_contact_threshold";

export type ReviewDecision =
  | { kind: "allow" }
  | {
      kind: "block";
      reason: ReviewBlockReason;
      severity: "medium" | "high";
      recommendedAction: string;
      summary: string;
    };

export type ScheduleContext = {
  completedStepType: string;
  now: Date;
  signal: WorkflowSignal;
};

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

export type WorkflowAction =
  | {
      type: "create_update";
      workflowRunId: string;
      summary: string;
      source: "voice_session" | "worker" | "reviewer";
    }
  | {
      type: "request_review";
      workflowRunId: string;
      reason: ReviewBlockReason;
      summary: string;
    }
  | {
      type: "mark_contact_attempt";
      workflowRunId: string;
      channel: ContactChannel;
      outcome: "reached" | "left_message" | "failed" | "refused";
      summary: string;
    }
  | {
      type: "schedule_follow_up";
      workflowRunId: string;
      dueAt: Date;
      stepType: string;
      reason: string;
    }
  | {
      type: "resolve_blocked_step";
      workflowRunId: string;
      reviewRequestId: string;
      resolution: "approved" | "edited" | "rejected" | "resolved";
      note: string;
    };
```

Create `src/modules/voice/types.ts`:

```ts
import type { WorkflowAction } from "@/modules/workflows/types";

export type VoiceSessionEvent =
  | {
      type: "transcript_chunk";
      sessionId: string;
      speaker: "agent" | "human";
      text: string;
      occurredAt: Date;
    }
  | {
      type: "tool_call";
      sessionId: string;
      toolCallId: string;
      action: WorkflowAction;
      occurredAt: Date;
    }
  | {
      type: "tool_result";
      sessionId: string;
      toolCallId: string;
      ok: boolean;
      message: string;
      occurredAt: Date;
    };

export type VoiceSessionAdapter = {
  startSession(input: {
    caseId: string;
    workflowRunId: string;
  }): AsyncIterable<VoiceSessionEvent>;
};
```

- [ ] **Step 3: Implement HITL policy and workflow definitions**

Create `src/modules/workflows/review-policy.ts`:

```ts
import type { ReviewDecision, WorkflowSignal } from "./types";

const sensitiveTerms = ["settlement", "lawsuit", "sue", "legal advice", "should i sign"];
const ambiguousTerms = ["not sure", "maybe", "i guess", "unclear", "confused"];
const refusalTerms = ["refuse", "will not", "cannot release", "no authorization"];

export function evaluateHumanReviewPolicy(signal: WorkflowSignal): ReviewDecision {
  const text = signal.text.toLowerCase();

  if (!signal.hasAuthorization && signal.actorRole === "provider") {
    return {
      kind: "block",
      reason: "missing_authorization",
      severity: "high",
      recommendedAction: "Upload or verify a signed medical-records authorization.",
      summary: "Provider interaction cannot proceed without authorization.",
    };
  }

  if (sensitiveTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "sensitive_legal_advice",
      severity: "high",
      recommendedAction: "Assign a firm teammate to respond.",
      summary: "The response appears to ask for legal advice or discuss legal strategy.",
    };
  }

  if (signal.actorRole === "client" && ambiguousTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "ambiguous_client_response",
      severity: "medium",
      recommendedAction: "Review the client response and clarify the next check-in.",
      summary: "The client response is ambiguous and needs human interpretation.",
    };
  }

  if (signal.actorRole === "provider" && refusalTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "provider_refusal",
      severity: "high",
      recommendedAction: "Have a staff member contact the provider.",
      summary: "The provider refused or could not release records.",
    };
  }

  if (signal.attemptCount >= 3) {
    return {
      kind: "block",
      reason: "failed_contact_threshold",
      severity: "medium",
      recommendedAction: "Review contact strategy before another attempt.",
      summary: "The workflow reached the failed contact attempt threshold.",
    };
  }

  return { kind: "allow" };
}
```

Create `src/modules/workflows/definitions.ts`:

```ts
import { evaluateHumanReviewPolicy } from "./review-policy";
import type { WorkflowDefinition, WorkflowStepTemplate } from "./types";

const providerFollowUpStep: WorkflowStepTemplate = {
  type: "provider_follow_up",
  label: "Follow up with provider",
  defaultDueInHours: 24,
  retryLimit: 3,
};

const clientCheckInStep: WorkflowStepTemplate = {
  type: "client_check_in",
  label: "Check in with client",
  defaultDueInHours: 72,
  retryLimit: 2,
};

export const medicalRecordsFollowUpDefinition: WorkflowDefinition = {
  id: "medical-records-follow-up",
  label: "Medical records follow-up",
  description: "Follow up with a medical provider for records status updates.",
  requiredContext: ["case", "client", "provider", "assigned_user"],
  stepTemplates: [providerFollowUpStep],
  allowedActions: ["create_update", "request_review", "mark_contact_attempt", "schedule_follow_up", "resolve_blocked_step"],
  reviewPolicy: evaluateHumanReviewPolicy,
  scheduleNextStep: ({ signal }) => {
    if (signal.text.toLowerCase().includes("records are ready")) {
      return null;
    }
    return providerFollowUpStep;
  },
};

export const clientCheckInDefinition: WorkflowDefinition = {
  id: "client-check-in",
  label: "Client check-in",
  description: "Periodically check in with a client and surface meaningful updates.",
  requiredContext: ["case", "client", "assigned_user"],
  stepTemplates: [clientCheckInStep],
  allowedActions: ["create_update", "request_review", "mark_contact_attempt", "schedule_follow_up", "resolve_blocked_step"],
  reviewPolicy: evaluateHumanReviewPolicy,
  scheduleNextStep: () => clientCheckInStep,
};

export const workflowDefinitions = [
  medicalRecordsFollowUpDefinition,
  clientCheckInDefinition,
] as const;

export function getWorkflowDefinition(id: WorkflowDefinition["id"]): WorkflowDefinition {
  const definition = workflowDefinitions.find((item) => item.id === id);
  if (!definition) {
    throw new Error(`Unknown workflow definition: ${id}`);
  }
  return definition;
}
```

- [ ] **Step 4: Verify workflow definition tests pass**

Run:

```powershell
npm run test:run -- tests/workflow-definitions.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Write review policy tests**

Create `tests/review-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateHumanReviewPolicy } from "@/modules/workflows/review-policy";
import type { WorkflowSignal } from "@/modules/workflows/types";

const baseSignal: WorkflowSignal = {
  text: "The records are in process.",
  channel: "phone",
  attemptCount: 1,
  hasAuthorization: true,
  actorRole: "provider",
};

describe("human review policy", () => {
  it("blocks missing provider authorization", () => {
    const decision = evaluateHumanReviewPolicy({ ...baseSignal, hasAuthorization: false });
    expect(decision).toMatchObject({ kind: "block", reason: "missing_authorization" });
  });

  it("blocks ambiguous client responses", () => {
    const decision = evaluateHumanReviewPolicy({
      ...baseSignal,
      actorRole: "client",
      text: "I am not sure, maybe my pain is worse.",
    });
    expect(decision).toMatchObject({ kind: "block", reason: "ambiguous_client_response" });
  });

  it("blocks provider refusal", () => {
    const decision = evaluateHumanReviewPolicy({
      ...baseSignal,
      text: "We cannot release anything without a new request.",
    });
    expect(decision).toMatchObject({ kind: "block", reason: "provider_refusal" });
  });

  it("allows ordinary status updates", () => {
    const decision = evaluateHumanReviewPolicy(baseSignal);
    expect(decision).toEqual({ kind: "allow" });
  });
});
```

Run:

```powershell
npm run test:run -- tests/review-policy.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Write action router tests**

Create `tests/action-router.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import type { WorkflowAction } from "@/modules/workflows/types";

describe("workflow action router", () => {
  it("routes allowed tool calls through the workflow engine", async () => {
    const applyAction = vi.fn().mockResolvedValue({ ok: true, message: "updated" });
    const action: WorkflowAction = {
      type: "create_update",
      workflowRunId: "run-1",
      summary: "Provider says records will be ready Friday.",
      source: "voice_session",
    };

    const result = await routeWorkflowAction({
      action,
      definition: medicalRecordsFollowUpDefinition,
      engine: { applyAction },
    });

    expect(result).toEqual({ ok: true, message: "updated" });
    expect(applyAction).toHaveBeenCalledWith(action);
  });

  it("rejects a tool call not allowed by a workflow definition", async () => {
    const applyAction = vi.fn();
    const definition = { ...medicalRecordsFollowUpDefinition, allowedActions: ["create_update"] };
    const action: WorkflowAction = {
      type: "request_review",
      workflowRunId: "run-1",
      reason: "provider_refusal",
      summary: "Provider refused.",
    };

    await expect(
      routeWorkflowAction({ action, definition, engine: { applyAction } }),
    ).rejects.toThrow("Action request_review is not allowed");
  });
});
```

Run:

```powershell
npm run test:run -- tests/action-router.test.ts
```

Expected: fails because `action-router.ts` does not exist.

- [ ] **Step 7: Implement the action router**

Create `src/modules/workflows/action-router.ts`:

```ts
import type { WorkflowAction, WorkflowDefinition } from "./types";

export type WorkflowActionResult = {
  ok: boolean;
  message: string;
};

export type WorkflowActionEngine = {
  applyAction(action: WorkflowAction): Promise<WorkflowActionResult>;
};

export async function routeWorkflowAction(input: {
  action: WorkflowAction;
  definition: WorkflowDefinition;
  engine: WorkflowActionEngine;
}): Promise<WorkflowActionResult> {
  const { action, definition, engine } = input;

  if (!definition.allowedActions.includes(action.type)) {
    throw new Error(`Action ${action.type} is not allowed for workflow ${definition.id}`);
  }

  return engine.applyAction(action);
}
```

- [ ] **Step 8: Verify pure workflow modules**

Run:

```powershell
npm run test:run -- tests/workflow-definitions.test.ts tests/review-policy.test.ts tests/action-router.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add src/modules tests
git commit -m "feat: add workflow definitions and action routing"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 3: Database Schema, Store Interface, and Seed Data

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/modules/workflows/store.ts`
- Create: `src/db/seed.ts`
- Create: `tests/test-store.ts`

**Interfaces:**
- Produces: `WorkflowStore` with methods used by `WorkflowEngine` and dashboard queries.
- Produces: Drizzle tables for cases, people, organizations, workflow runs, steps, events, reviews, contact attempts, voice sessions, and voice events.
- Consumes: `WorkflowAction`, status types, and definition ids from Task 2.

- [ ] **Step 1: Create Drizzle config**

Create `drizzle.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/hellocouncil",
  },
});
```

- [ ] **Step 2: Define Drizzle schema**

Create `src/db/schema.ts` with these tables:

```ts
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterName: text("matter_name").notNull(),
  status: text("status").notNull(),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => people.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseParticipants = pgTable("case_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  personId: uuid("person_id").references(() => people.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  role: text("role").notNull(),
});

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: text("definition_id").notNull(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  status: text("status").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    stepType: text("step_type").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dueIdx: index("workflow_steps_due_idx").on(table.status, table.dueAt),
  }),
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    actorType: text("actor_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("workflow_events_run_idx").on(table.workflowRunId, table.occurredAt),
  }),
);

export const humanReviewRequests = pgTable("human_review_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => people.id),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactAttempts = pgTable("contact_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
  channel: text("channel").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  syntheticResponse: text("synthetic_response"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSessions = pgTable("voice_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const voiceSessionEvents = pgTable("voice_session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
  type: text("type").notNull(),
  speaker: text("speaker"),
  text: text("text"),
  toolCallId: text("tool_call_id"),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Create DB client**

Create `src/db/client.ts`:

```ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
export type DbClient = typeof db;
```

- [ ] **Step 4: Define the workflow store interface and Drizzle adapter**

Create `src/modules/workflows/store.ts`:

```ts
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import {
  contactAttempts,
  humanReviewRequests,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import type { ReviewDecision, WorkflowAction, WorkflowDefinitionId, WorkflowRunStatus, WorkflowStepStatus } from "./types";

export type WorkflowRunRecord = {
  id: string;
  definitionId: WorkflowDefinitionId;
  caseId: string;
  status: WorkflowRunStatus;
  title: string;
  summary: string;
};

export type WorkflowStepRecord = {
  id: string;
  workflowRunId: string;
  stepType: string;
  label: string;
  status: WorkflowStepStatus;
  dueAt: Date;
  attemptCount: number;
  payload: unknown;
};

export type AppendWorkflowEventInput = {
  workflowRunId: string;
  type: string;
  summary: string;
  actorType: "worker" | "voice_agent" | "reviewer" | "system";
  payload?: Record<string, unknown>;
};

export type CreateReviewInput = {
  workflowRunId: string;
  workflowStepId?: string;
  decision: Extract<ReviewDecision, { kind: "block" }>;
};

export type WorkflowStore = {
  getRun(id: string): Promise<WorkflowRunRecord>;
  getDueSteps(now: Date): Promise<WorkflowStepRecord[]>;
  getStep(id: string): Promise<WorkflowStepRecord>;
  updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string): Promise<void>;
  updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number): Promise<void>;
  createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }): Promise<WorkflowStepRecord>;
  appendEvent(input: AppendWorkflowEventInput): Promise<void>;
  createReview(input: CreateReviewInput): Promise<string>;
  resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }): Promise<void>;
  createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }): Promise<void>;
  applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }>;
};

export class DrizzleWorkflowStore implements WorkflowStore {
  constructor(private readonly client: DbClient = db) {}

  async getRun(id: string): Promise<WorkflowRunRecord> {
    const [run] = await this.client.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run as WorkflowRunRecord;
  }

  async getDueSteps(now: Date): Promise<WorkflowStepRecord[]> {
    const rows = await this.client
      .select()
      .from(workflowSteps)
      .where(and(eq(workflowSteps.status, "due"), lte(workflowSteps.dueAt, now)))
      .orderBy(asc(workflowSteps.dueAt));
    return rows as WorkflowStepRecord[];
  }

  async getStep(id: string): Promise<WorkflowStepRecord> {
    const [step] = await this.client.select().from(workflowSteps).where(eq(workflowSteps.id, id));
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step as WorkflowStepRecord;
  }

  async updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string): Promise<void> {
    await this.client
      .update(workflowRuns)
      .set({ status, summary, updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }

  async updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({ status, attemptCount, updatedAt: new Date() })
      .where(eq(workflowSteps.id, id));
  }

  async createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }): Promise<WorkflowStepRecord> {
    const [step] = await this.client
      .insert(workflowSteps)
      .values({
        workflowRunId: input.workflowRunId,
        stepType: input.stepType,
        label: input.label,
        status: "due",
        dueAt: input.dueAt,
        payload: input.payload ?? {},
      })
      .returning();
    return step as WorkflowStepRecord;
  }

  async appendEvent(input: AppendWorkflowEventInput): Promise<void> {
    await this.client.insert(workflowEvents).values({
      workflowRunId: input.workflowRunId,
      type: input.type,
      summary: input.summary,
      actorType: input.actorType,
      payload: input.payload ?? {},
    });
  }

  async createReview(input: CreateReviewInput): Promise<string> {
    const [review] = await this.client
      .insert(humanReviewRequests)
      .values({
        workflowRunId: input.workflowRunId,
        workflowStepId: input.workflowStepId,
        status: "open",
        reason: input.decision.reason,
        severity: input.decision.severity,
        summary: input.decision.summary,
        recommendedAction: input.decision.recommendedAction,
      })
      .returning({ id: humanReviewRequests.id });
    return review.id;
  }

  async resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }): Promise<void> {
    await this.client
      .update(humanReviewRequests)
      .set({ status: input.status, reviewerNote: input.note, updatedAt: new Date() })
      .where(eq(humanReviewRequests.id, input.reviewRequestId));
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }): Promise<void> {
    await this.client.insert(contactAttempts).values(input);
  }

  async applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }> {
    await this.appendEvent({
      workflowRunId: action.workflowRunId,
      type: `action.${action.type}`,
      summary: "Voice action routed into workflow engine.",
      actorType: "voice_agent",
      payload: action,
    });
    return { ok: true, message: `Applied ${action.type}` };
  }

  async recentEvents(limit = 20) {
    return this.client.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(limit);
  }
}
```

- [ ] **Step 5: Create in-memory test store**

Create `tests/test-store.ts`:

```ts
import type {
  AppendWorkflowEventInput,
  CreateReviewInput,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowStore,
} from "@/modules/workflows/store";
import type { WorkflowAction, WorkflowRunStatus, WorkflowStepStatus } from "@/modules/workflows/types";

export class TestWorkflowStore implements WorkflowStore {
  runs = new Map<string, WorkflowRunRecord>();
  steps = new Map<string, WorkflowStepRecord>();
  events: AppendWorkflowEventInput[] = [];
  reviews: Array<CreateReviewInput & { id: string; status: string; note?: string }> = [];
  contactAttempts: Array<Record<string, unknown>> = [];

  async getRun(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run;
  }

  async getDueSteps(now: Date) {
    return [...this.steps.values()].filter((step) => step.status === "due" && step.dueAt <= now);
  }

  async getStep(id: string) {
    const step = this.steps.get(id);
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step;
  }

  async updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string) {
    const run = await this.getRun(id);
    this.runs.set(id, { ...run, status, summary: summary ?? run.summary });
  }

  async updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number) {
    const step = await this.getStep(id);
    this.steps.set(id, { ...step, status, attemptCount: attemptCount ?? step.attemptCount });
  }

  async createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }) {
    const step: WorkflowStepRecord = {
      id: `step-${this.steps.size + 1}`,
      workflowRunId: input.workflowRunId,
      stepType: input.stepType,
      label: input.label,
      status: "due",
      dueAt: input.dueAt,
      attemptCount: 0,
      payload: input.payload ?? {},
    };
    this.steps.set(step.id, step);
    return step;
  }

  async appendEvent(input: AppendWorkflowEventInput) {
    this.events.push(input);
  }

  async createReview(input: CreateReviewInput) {
    const id = `review-${this.reviews.length + 1}`;
    this.reviews.push({ ...input, id, status: "open" });
    return id;
  }

  async resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }) {
    const review = this.reviews.find((item) => item.id === input.reviewRequestId);
    if (!review) throw new Error(`Review not found: ${input.reviewRequestId}`);
    review.status = input.status;
    review.note = input.note;
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }) {
    this.contactAttempts.push(input);
  }

  async applyAction(action: WorkflowAction) {
    await this.appendEvent({
      workflowRunId: action.workflowRunId,
      type: `action.${action.type}`,
      summary: "Applied action in test store.",
      actorType: "voice_agent",
      payload: action,
    });
    return { ok: true, message: `Applied ${action.type}` };
  }
}
```

- [ ] **Step 6: Create seed data**

Create `src/db/seed.ts`:

```ts
import { db, pool } from "./client";
import {
  caseParticipants,
  cases,
  contactAttempts,
  humanReviewRequests,
  organizations,
  people,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "./schema";

async function main() {
  const [attorney] = await db.insert(people).values({
    name: "Maya Singh",
    role: "firm_user",
    email: "maya@hellocounsel.local",
  }).returning();

  const [clientA] = await db.insert(people).values({
    name: "Jordan Lee",
    role: "client",
    phone: "555-0101",
  }).returning();

  const [clientB] = await db.insert(people).values({
    name: "Elena Park",
    role: "client",
    phone: "555-0102",
  }).returning();

  const [provider] = await db.insert(organizations).values({
    name: "Northside Imaging",
    type: "medical_provider",
    phone: "555-0199",
  }).returning();

  const [caseA] = await db.insert(cases).values({
    matterName: "Lee v. Metro Transit",
    status: "active",
    assignedUserId: attorney.id,
  }).returning();

  const [caseB] = await db.insert(cases).values({
    matterName: "Park v. Oak Logistics",
    status: "active",
    assignedUserId: attorney.id,
  }).returning();

  await db.insert(caseParticipants).values([
    { caseId: caseA.id, personId: clientA.id, role: "client" },
    { caseId: caseA.id, organizationId: provider.id, role: "medical_provider" },
    { caseId: caseB.id, personId: clientB.id, role: "client" },
  ]);

  const [medicalRun] = await db.insert(workflowRuns).values({
    definitionId: "medical-records-follow-up",
    caseId: caseA.id,
    status: "waiting_for_human",
    title: "Northside Imaging records follow-up",
    summary: "Provider refused release until authorization is verified.",
  }).returning();

  const [clientRun] = await db.insert(workflowRuns).values({
    definitionId: "client-check-in",
    caseId: caseB.id,
    status: "active",
    title: "Monthly client check-in",
    summary: "Next check-in is due.",
  }).returning();

  const [blockedStep] = await db.insert(workflowSteps).values({
    workflowRunId: medicalRun.id,
    stepType: "provider_follow_up",
    label: "Follow up with provider",
    status: "waiting_for_human",
    dueAt: new Date(Date.now() - 60 * 60 * 1000),
    attemptCount: 2,
    payload: { providerName: provider.name },
  }).returning();

  await db.insert(workflowSteps).values({
    workflowRunId: clientRun.id,
    stepType: "client_check_in",
    label: "Check in with client",
    status: "due",
    dueAt: new Date(Date.now() - 30 * 60 * 1000),
    attemptCount: 0,
    payload: { clientName: clientB.name },
  });

  await db.insert(humanReviewRequests).values({
    workflowRunId: medicalRun.id,
    workflowStepId: blockedStep.id,
    status: "open",
    reason: "provider_refusal",
    severity: "high",
    summary: "Provider said they cannot release records without a verified authorization.",
    recommendedAction: "Verify authorization and contact Northside Imaging.",
  });

  await db.insert(contactAttempts).values({
    workflowRunId: medicalRun.id,
    workflowStepId: blockedStep.id,
    channel: "phone",
    outcome: "refused",
    summary: "Provider refused to release records.",
    syntheticResponse: "We cannot release anything without a new authorization.",
  });

  await db.insert(workflowEvents).values([
    {
      workflowRunId: medicalRun.id,
      type: "workflow.started",
      summary: "Medical records follow-up started.",
      actorType: "system",
      payload: {},
    },
    {
      workflowRunId: medicalRun.id,
      type: "review.created",
      summary: "Human review created for provider refusal.",
      actorType: "worker",
      payload: { reason: "provider_refusal" },
    },
    {
      workflowRunId: clientRun.id,
      type: "workflow.started",
      summary: "Client check-in workflow started.",
      actorType: "system",
      payload: {},
    },
  ]);

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
```

- [ ] **Step 7: Generate and apply migrations**

Start Postgres:

```powershell
docker compose up -d postgres
```

Copy env:

```powershell
Copy-Item .env.example .env
```

Run:

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
```

Expected: migrations are generated under `drizzle/`, applied to Postgres, and seed script exits with code 0.

- [ ] **Step 8: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add drizzle.config.ts docker-compose.yml .env.example src/db src/modules/workflows/store.ts tests/test-store.ts drizzle
git commit -m "feat: add workflow database schema and seed data"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 4: Workflow Engine and Worker Transitions

**Files:**
- Create: `src/modules/workflows/engine.ts`
- Create: `src/modules/workflows/synthetic-responses.ts`
- Create: `src/worker/boss.ts`
- Create: `src/worker/run-due-step.ts`
- Create: `src/worker/start.ts`
- Create: `tests/worker-transitions.test.ts`

**Interfaces:**
- Consumes: `WorkflowStore`, `WorkflowDefinition`, `WorkflowSignal`.
- Produces: `WorkflowEngine.advanceDueStep(stepId, now)` and `runDueStepJob({ stepId })`.
- Later UI actions call `WorkflowEngine.applyAction`.

- [ ] **Step 1: Write worker transition tests**

Create `tests/worker-transitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { TestWorkflowStore } from "./test-store";

function storeWithRun(definitionId: "client-check-in" | "medical-records-follow-up") {
  const store = new TestWorkflowStore();
  store.runs.set("run-1", {
    id: "run-1",
    definitionId,
    caseId: "case-1",
    status: "active",
    title: "Test run",
    summary: "",
  });
  store.steps.set("step-1", {
    id: "step-1",
    workflowRunId: "run-1",
    stepType: definitionId === "client-check-in" ? "client_check_in" : "provider_follow_up",
    label: "Due step",
    status: "due",
    dueAt: new Date("2026-08-23T00:00:00.000Z"),
    attemptCount: 0,
    payload: {},
  });
  return store;
}

describe("worker transitions", () => {
  it("completes an allowed due step and schedules the next step", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {
        client_check_in: "Client reports recovery is improving and has no questions.",
      },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("completed");
    expect([...store.steps.values()].some((step) => step.id !== "step-1" && step.status === "due")).toBe(true);
    expect(store.events.map((event) => event.type)).toContain("step.completed");
  });

  it("blocks a due step and creates a review request when policy requires human review", async () => {
    const store = storeWithRun("medical-records-follow-up");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {
        provider_follow_up: "We cannot release anything without a new authorization.",
      },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("provider_refusal");
    expect(store.events.map((event) => event.type)).toContain("review.created");
  });

  it("resolves a blocked step through a controlled review action", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.reviews.push({
      id: "review-1",
      status: "open",
      workflowRunId: "run-1",
      workflowStepId: "step-1",
      decision: {
        kind: "block",
        reason: "provider_refusal",
        severity: "high",
        recommendedAction: "Call provider.",
        summary: "Provider refused.",
      },
    });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {},
    });

    await engine.applyAction({
      type: "resolve_blocked_step",
      workflowRunId: "run-1",
      reviewRequestId: "review-1",
      resolution: "resolved",
      note: "Authorization verified.",
    });

    expect(store.reviews[0]?.status).toBe("resolved");
    expect(store.events.map((event) => event.type)).toContain("review.resolved");
  });
});
```

Run:

```powershell
npm run test:run -- tests/worker-transitions.test.ts
```

Expected: fails because `WorkflowEngine` does not exist.

- [ ] **Step 2: Create synthetic responses**

Create `src/modules/workflows/synthetic-responses.ts`:

```ts
export const defaultSyntheticResponses: Record<string, string> = {
  provider_follow_up: "Provider says records are in process and should be ready Friday.",
  client_check_in: "Client reports recovery is improving and has no questions.",
};

export function getSyntheticResponse(stepType: string, overrides: Record<string, string> = {}) {
  return overrides[stepType] ?? defaultSyntheticResponses[stepType] ?? "No synthetic response configured.";
}
```

- [ ] **Step 3: Implement the workflow engine**

Create `src/modules/workflows/engine.ts`:

```ts
import { getSyntheticResponse } from "./synthetic-responses";
import type { WorkflowStore } from "./store";
import type { WorkflowAction, WorkflowDefinition, WorkflowSignal } from "./types";

export class WorkflowEngine {
  private readonly definitionsById: Map<string, WorkflowDefinition>;

  constructor(
    private readonly input: {
      store: WorkflowStore;
      definitions: readonly WorkflowDefinition[];
      syntheticResponses?: Record<string, string>;
    },
  ) {
    this.definitionsById = new Map(input.definitions.map((definition) => [definition.id, definition]));
  }

  async advanceDueStep(stepId: string, now: Date): Promise<void> {
    const step = await this.input.store.getStep(stepId);
    const run = await this.input.store.getRun(step.workflowRunId);
    const definition = this.definitionFor(run.definitionId);

    await this.input.store.updateStepStatus(step.id, "running", step.attemptCount + 1);
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.running",
      summary: `${step.label} started.`,
      actorType: "worker",
      payload: { stepId: step.id, stepType: step.stepType },
    });

    const syntheticResponse = getSyntheticResponse(step.stepType, this.input.syntheticResponses);
    const signal = this.signalForStep(step.stepType, syntheticResponse, step.attemptCount + 1);

    await this.input.store.createContactAttempt({
      workflowRunId: run.id,
      workflowStepId: step.id,
      channel: signal.channel,
      outcome: signal.text.toLowerCase().includes("cannot") ? "refused" : "reached",
      summary: `Synthetic ${signal.channel} attempt: ${syntheticResponse}`,
      syntheticResponse,
    });

    const decision = definition.reviewPolicy(signal);

    if (decision.kind === "block") {
      await this.input.store.updateStepStatus(step.id, "waiting_for_human", step.attemptCount + 1);
      await this.input.store.updateRunStatus(run.id, "waiting_for_human", decision.summary);
      await this.input.store.createReview({ workflowRunId: run.id, workflowStepId: step.id, decision });
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "review.created",
        summary: decision.summary,
        actorType: "worker",
        payload: decision,
      });
      return;
    }

    await this.input.store.updateStepStatus(step.id, "completed", step.attemptCount + 1);
    await this.input.store.updateRunStatus(run.id, "active", syntheticResponse);
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.completed",
      summary: syntheticResponse,
      actorType: "worker",
      payload: { stepId: step.id, stepType: step.stepType },
    });

    const nextStep = definition.scheduleNextStep({
      completedStepType: step.stepType,
      now,
      signal,
    });

    if (nextStep) {
      const dueAt = new Date(now.getTime() + nextStep.defaultDueInHours * 60 * 60 * 1000);
      await this.input.store.createStep({
        workflowRunId: run.id,
        stepType: nextStep.type,
        label: nextStep.label,
        dueAt,
        payload: {},
      });
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "step.scheduled",
        summary: `${nextStep.label} scheduled.`,
        actorType: "worker",
        payload: { stepType: nextStep.type, dueAt: dueAt.toISOString() },
      });
    } else {
      await this.input.store.updateRunStatus(run.id, "completed", "Workflow completed.");
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "workflow.completed",
        summary: "Workflow completed.",
        actorType: "worker",
      });
    }
  }

  async applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }> {
    if (action.type === "resolve_blocked_step") {
      await this.input.store.resolveReview({
        reviewRequestId: action.reviewRequestId,
        status: action.resolution,
        note: action.note,
      });
      await this.input.store.updateRunStatus(action.workflowRunId, "active", action.note);
      await this.input.store.appendEvent({
        workflowRunId: action.workflowRunId,
        type: "review.resolved",
        summary: action.note,
        actorType: "reviewer",
        payload: action,
      });
      return { ok: true, message: "Review resolved and workflow reactivated." };
    }

    return this.input.store.applyAction(action);
  }

  private definitionFor(id: string) {
    const definition = this.definitionsById.get(id);
    if (!definition) throw new Error(`Unknown workflow definition: ${id}`);
    return definition;
  }

  private signalForStep(stepType: string, text: string, attemptCount: number): WorkflowSignal {
    const actorRole = stepType === "client_check_in" ? "client" : "provider";
    return {
      text,
      channel: "phone",
      attemptCount,
      hasAuthorization: true,
      actorRole,
    };
  }
}
```

- [ ] **Step 4: Verify worker transition tests**

Run:

```powershell
npm run test:run -- tests/worker-transitions.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Implement pg-boss worker entrypoints**

Create `src/worker/boss.ts`:

```ts
import "dotenv/config";
import PgBoss from "pg-boss";

export const jobNames = {
  runDueStep: "workflow.run-due-step",
} as const;

export function createBoss() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  return new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });
}
```

Create `src/worker/run-due-step.ts`:

```ts
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export type RunDueStepJob = {
  stepId: string;
};

export async function runDueStepJob(job: RunDueStepJob) {
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [medicalRecordsFollowUpDefinition, clientCheckInDefinition],
  });

  await engine.advanceDueStep(job.stepId, new Date());
}
```

Create `src/worker/start.ts`:

```ts
import { createBoss, jobNames } from "./boss";
import { runDueStepJob, type RunDueStepJob } from "./run-due-step";

async function main() {
  const boss = createBoss();
  await boss.start();

  await boss.work<RunDueStepJob>(jobNames.runDueStep, async ([job]) => {
    await runDueStepJob(job.data);
  });

  console.log(`Worker listening for ${jobNames.runDueStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 6: Verify engine and worker compile**

Run:

```powershell
npm run test:run -- tests/worker-transitions.test.ts
npm run build
```

Expected: worker transition tests pass and build completes.

- [ ] **Step 7: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add src/modules/workflows src/worker tests/worker-transitions.test.ts
git commit -m "feat: add workflow engine and due-step worker"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 5: Dashboard Read Model and UI Surfaces

**Files:**
- Create: `src/modules/dashboard/queries.ts`
- Modify: `app/page.tsx`
- Create: `app/workflows/[id]/page.tsx`
- Create: `app/review/page.tsx`
- Create: `app/actions/review.ts`

**Interfaces:**
- Consumes: Drizzle schema and workflow store.
- Produces: UI surfaces for dashboard, workflow detail, and review queue.
- Produces: server action `resolveReviewAction(formData)`.

- [ ] **Step 1: Create dashboard query module**

Create `src/modules/dashboard/queries.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  cases,
  contactAttempts,
  humanReviewRequests,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";

export async function getDashboardData() {
  const runs = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.updatedAt)).limit(12);
  const reviews = await db.select().from(humanReviewRequests).where(eq(humanReviewRequests.status, "open")).limit(12);
  const dueSteps = await db.select().from(workflowSteps).where(eq(workflowSteps.status, "due")).limit(12);
  const events = await db.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(12);

  return {
    runs,
    reviews,
    dueSteps,
    events,
    counts: {
      activeRuns: runs.filter((run) => run.status === "active").length,
      blockedRuns: runs.filter((run) => run.status === "waiting_for_human").length,
      openReviews: reviews.length,
      dueSteps: dueSteps.length,
    },
  };
}

export async function getWorkflowDetail(id: string) {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  if (!run) return null;

  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, run.caseId));
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, id));
  const reviews = await db.select().from(humanReviewRequests).where(eq(humanReviewRequests.workflowRunId, id));
  const attempts = await db.select().from(contactAttempts).where(eq(contactAttempts.workflowRunId, id));
  const events = await db.select().from(workflowEvents).where(eq(workflowEvents.workflowRunId, id)).orderBy(desc(workflowEvents.occurredAt));

  return { run, caseRecord, steps, reviews, attempts, events };
}
```

- [ ] **Step 2: Replace dashboard page**

Modify `app/page.tsx`:

```tsx
import Link from "next/link";
import { AlertCircle, CalendarClock, History, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { getDashboardData } from "@/modules/dashboard/queries";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operations dashboard</h1>
        <p className="text-sm text-muted">Long-running agent workflows across active cases.</p>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric icon={<Workflow size={18} />} label="Active runs" value={data.counts.activeRuns} />
        <Metric icon={<AlertCircle size={18} />} label="Blocked runs" value={data.counts.blockedRuns} />
        <Metric icon={<AlertCircle size={18} />} label="Open reviews" value={data.counts.openReviews} />
        <Metric icon={<CalendarClock size={18} />} label="Due steps" value={data.counts.dueSteps} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Workflow runs">
          <div className="divide-y divide-line">
            {data.runs.map((run) => (
              <Link key={run.id} href={`/workflows/${run.id}`} className="block py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{run.title}</p>
                    <p className="text-sm text-muted">{run.summary}</p>
                  </div>
                  <Status status={run.status} />
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Blocked review items">
          <div className="divide-y divide-line">
            {data.reviews.map((review) => (
              <div key={review.id} className="py-3">
                <p className="font-medium">{review.reason}</p>
                <p className="text-sm text-muted">{review.summary}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel title="Recent audit events" icon={<History size={18} />}>
        <div className="divide-y divide-line">
          {data.events.map((event) => (
            <div key={event.id} className="py-3">
              <p className="font-medium">{event.type}</p>
              <p className="text-sm text-muted">{event.summary}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-muted">{icon}{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Status({ status }: { status: string }) {
  return <span className="rounded border border-line px-2 py-1 text-xs text-muted">{status}</span>;
}
```

- [ ] **Step 3: Create workflow detail page**

Create `app/workflows/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getWorkflowDetail } from "@/modules/dashboard/queries";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getWorkflowDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{detail.run.title}</h1>
        <p className="text-sm text-muted">{detail.caseRecord?.matterName} - {detail.run.status}</p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Steps">
          {detail.steps.map((step) => (
            <div key={step.id} className="border-b border-line py-3 last:border-b-0">
              <p className="font-medium">{step.label}</p>
              <p className="text-sm text-muted">{step.status} - due {step.dueAt.toLocaleString()}</p>
            </div>
          ))}
        </Panel>
        <Panel title="Human review">
          {detail.reviews.map((review) => (
            <div key={review.id} className="border-b border-line py-3 last:border-b-0">
              <p className="font-medium">{review.reason}</p>
              <p className="text-sm text-muted">{review.summary}</p>
            </div>
          ))}
        </Panel>
      </section>

      <Panel title="Contact attempts">
        {detail.attempts.map((attempt) => (
          <div key={attempt.id} className="border-b border-line py-3 last:border-b-0">
            <p className="font-medium">{attempt.channel} - {attempt.outcome}</p>
            <p className="text-sm text-muted">{attempt.summary}</p>
          </div>
        ))}
      </Panel>

      <Panel title="Audit timeline">
        {detail.events.map((event) => (
          <div key={event.id} className="border-b border-line py-3 last:border-b-0">
            <p className="font-medium">{event.type}</p>
            <p className="text-sm text-muted">{event.summary}</p>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Create review server action and queue page**

Create `app/actions/review.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export async function resolveReviewAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId"));
  const reviewRequestId = String(formData.get("reviewRequestId"));
  const resolution = String(formData.get("resolution")) as "approved" | "edited" | "rejected" | "resolved";
  const note = String(formData.get("note") || "Reviewed by firm user.");

  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [medicalRecordsFollowUpDefinition, clientCheckInDefinition],
  });

  await engine.applyAction({
    type: "resolve_blocked_step",
    workflowRunId,
    reviewRequestId,
    resolution,
    note,
  });

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/workflows/${workflowRunId}`);
}
```

Create `app/review/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { humanReviewRequests } from "@/db/schema";
import { resolveReviewAction } from "@/app/actions/review";

export default async function ReviewPage() {
  const reviews = await db.select().from(humanReviewRequests).where(eq(humanReviewRequests.status, "open"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted">Policy-blocked workflow items that need a firm teammate.</p>
      </div>
      <div className="space-y-3">
        {reviews.map((review) => (
          <form key={review.id} action={resolveReviewAction} className="rounded border border-line bg-white p-4">
            <input type="hidden" name="workflowRunId" value={review.workflowRunId} />
            <input type="hidden" name="reviewRequestId" value={review.id} />
            <input type="hidden" name="resolution" value="resolved" />
            <p className="font-medium">{review.reason}</p>
            <p className="mt-1 text-sm text-muted">{review.summary}</p>
            <label className="mt-3 block text-sm font-medium" htmlFor={`note-${review.id}`}>Reviewer note</label>
            <textarea id={`note-${review.id}`} name="note" className="mt-1 min-h-20 w-full rounded border border-line p-2 text-sm" defaultValue={review.recommendedAction} />
            <button className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
              Resolve blocked step
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify UI compiles**

Run:

```powershell
npm run build
```

Expected: build completes.

- [ ] **Step 6: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add app src/modules/dashboard
git commit -m "feat: add workflow dashboard and review UI"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 6: Simulated Voice Session Framework

**Files:**
- Create: `src/modules/voice/simulated-adapter.ts`
- Create: `app/actions/voice.ts`
- Create: `app/voice/page.tsx`
- Modify: `src/db/schema.ts` only if the Task 3 voice event schema needs a type correction.

**Interfaces:**
- Consumes: `VoiceSessionAdapter`, `WorkflowActionRouter`, `WorkflowEngine`.
- Produces: a simulated voice console that routes structured tool calls into workflow actions.

- [ ] **Step 1: Create simulated adapter**

Create `src/modules/voice/simulated-adapter.ts`:

```ts
import type { VoiceSessionAdapter, VoiceSessionEvent } from "./types";

export class SimulatedVoiceSessionAdapter implements VoiceSessionAdapter {
  async *startSession(input: { caseId: string; workflowRunId: string }): AsyncIterable<VoiceSessionEvent> {
    const sessionId = `sim-${input.workflowRunId}`;
    const now = new Date();

    yield {
      type: "transcript_chunk",
      sessionId,
      speaker: "agent",
      text: "I can log this provider update against the workflow.",
      occurredAt: now,
    };

    yield {
      type: "transcript_chunk",
      sessionId,
      speaker: "human",
      text: "Northside says records will be ready Friday.",
      occurredAt: new Date(now.getTime() + 500),
    };

    yield {
      type: "tool_call",
      sessionId,
      toolCallId: "tool-1",
      action: {
        type: "create_update",
        workflowRunId: input.workflowRunId,
        summary: "Northside says records will be ready Friday.",
        source: "voice_session",
      },
      occurredAt: new Date(now.getTime() + 1000),
    };
  }
}
```

- [ ] **Step 2: Create voice action**

Create `app/actions/voice.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { clientCheckInDefinition, getWorkflowDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";

export async function runSimulatedVoiceSessionAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const workflowRunId = String(formData.get("workflowRunId"));
  const definitionId = String(formData.get("definitionId")) as "medical-records-follow-up" | "client-check-in";

  const adapter = new SimulatedVoiceSessionAdapter();
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [medicalRecordsFollowUpDefinition, clientCheckInDefinition],
  });
  const definition = getWorkflowDefinition(definitionId);

  for await (const event of adapter.startSession({ caseId, workflowRunId })) {
    if (event.type === "tool_call") {
      await routeWorkflowAction({
        action: event.action,
        definition,
        engine,
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/voice");
  revalidatePath(`/workflows/${workflowRunId}`);
}
```

- [ ] **Step 3: Create voice console page**

Create `app/voice/page.tsx`:

```tsx
import { db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import { runSimulatedVoiceSessionAction } from "@/app/actions/voice";

export default async function VoicePage() {
  const runs = await db.select().from(workflowRuns).limit(10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Simulated voice session</h1>
        <p className="text-sm text-muted">
          Replays transcript chunks and structured tool calls through the platform action router.
        </p>
      </div>

      <div className="space-y-3">
        {runs.map((run) => (
          <form key={run.id} action={runSimulatedVoiceSessionAction} className="rounded border border-line bg-white p-4">
            <input type="hidden" name="caseId" value={run.caseId} />
            <input type="hidden" name="workflowRunId" value={run.id} />
            <input type="hidden" name="definitionId" value={run.definitionId} />
            <p className="font-medium">{run.title}</p>
            <p className="text-sm text-muted">{run.summary}</p>
            <button className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
              Run simulated session
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify voice routing still passes tests**

Run:

```powershell
npm run test:run -- tests/action-router.test.ts
npm run build
```

Expected: action router tests pass and build completes.

- [ ] **Step 5: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add app/actions/voice.ts app/voice src/modules/voice
git commit -m "feat: add simulated voice session framework"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 7: Assignment Note and Runbook

**Files:**
- Create: `docs/assignment-note.md`
- Create: `README.md`

**Interfaces:**
- Produces: reviewer-facing explanation required by the assignment.
- Produces: local run instructions.

- [ ] **Step 1: Create assignment note**

Create `docs/assignment-note.md`:

```md
# Long-Running Agents Platform Note

## Design Chosen

This slice implements a reusable platform around long-running legal-agent workflows. The voice agent runtime is outside the scope of the slice; the platform provides the framework around it: voice-session ingestion, structured tool routing, durable workflow state, human review, timers, retries, and audit events.

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

## Stubbed

- Real voice-agent runtime
- LiveKit/OpenAI session creation
- Phone, SMS, email, and provider portal integrations
- Authentication and firm tenancy
- Production observability

## Where It Breaks Down Today

The simulated voice session proves the provider seam and tool-routing contract, but it does not validate real audio latency, VAD, or interruption behavior. Synthetic communication responses cannot capture the variance of medical providers or client conversations. The DB-backed worker is appropriate for this slice, while multi-month workflows with more complex branching would justify Temporal.

## Adding a New Use Case

Add a new `WorkflowDefinition` with metadata, step templates, schedule policy, review policy, and allowed actions. Add seed data or a creation path. Add synthetic responses for the worker. The dashboard, review queue, audit timeline, and voice action router do not need workflow-specific changes.

Example: lien verification could define a lienholder follow-up step, block on disputed amounts or missing authorization, and complete when the lien status is confirmed.

## What I Would Build Next

1. Replace the simulated voice adapter with LiveKit Agents + OpenAI Realtime.
2. Add authentication, firm tenancy, and role-based review permissions.
3. Add real communication adapters behind a communication seam.
4. Add worker observability and stuck-step alerts.
5. Move to Temporal if workflow branching and duration outgrow the DB-backed runner.
```

- [ ] **Step 2: Create README**

Create `README.md`:

```md
# HelloCounsel Long-Running Agents Platform

Working slice of a reusable platform for long-running legal-agent workflows.

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

```powershell
npm run worker
```

## Verification

```powershell
npm run test:run
npm run lint
npm run build
```

## Design

See `docs/superpowers/specs/2026-08-23-long-running-agents-platform-design.md` and `docs/assignment-note.md`.
```

- [ ] **Step 3: Verify docs exist**

Run:

```powershell
Test-Path docs\assignment-note.md; Test-Path README.md
```

Expected:

```text
True
True
```

- [ ] **Step 4: Commit if this is a git repo**

Run:

```powershell
git status --short
```

If it succeeds, commit:

```powershell
git add docs/assignment-note.md README.md
git commit -m "docs: explain assignment platform slice"
```

If the repo is not initialized, skip the commit and record that.

---

### Task 8: Final Verification and Local Run

**Files:**
- Modify only files required to fix verification failures.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified working slice and local URL.

- [ ] **Step 1: Run full unit and integration tests**

Run:

```powershell
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: lint exits with code 0.

- [ ] **Step 3: Run production build**

Run:

```powershell
npm run build
```

Expected: Next.js build exits with code 0.

- [ ] **Step 4: Verify seeded app path**

Start dependencies and app:

```powershell
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Expected: app is available at `http://localhost:3000`.

Manual smoke check:

- Dashboard loads and shows active runs, blocked reviews, due steps, and audit events.
- Review page shows at least one open review item.
- Workflow detail page opens from a dashboard run.
- Voice page runs a simulated session and records an audit event.

- [ ] **Step 5: Start worker in a second shell**

Run:

```powershell
npm run worker
```

Expected: worker logs `Worker listening for workflow.run-due-step`.

- [ ] **Step 6: Record final status**

Run:

```powershell
git status --short
```

If this is a git repo, ensure only intended changes remain and commit final fixes:

```powershell
git add .
git commit -m "feat: build long-running agents platform slice"
```

If this is not a git repo, write the final response with:

- Tests run and exit status.
- Build/lint status.
- Local URL.
- Note that commits were skipped because the workspace is not a git repo.
