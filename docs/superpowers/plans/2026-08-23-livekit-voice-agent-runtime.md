# LiveKit Voice Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LiveKit-only real streaming voice-agent runtime that connects browser microphone sessions to the existing legal workflow platform through conservative structured tools.

**Architecture:** The Next.js app remains the workflow dashboard and token/session launcher. A separate LiveKit Agents Node worker joins LiveKit Cloud rooms, runs a streaming VAD/STT/LLM/TTS pipeline through LiveKit Inference, and routes agent tool calls through the existing `WorkflowEngine` and `routeWorkflowAction`. The existing simulated voice path remains as deterministic local fallback.

**Tech Stack:** Next.js App Router, TypeScript, LiveKit Cloud, `@livekit/agents`, LiveKit Inference, LiveKit React components, `livekit-server-sdk`, Drizzle, Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-livekit-voice-agent-runtime-design.md`

## Global Constraints

- This phase is LiveKit-only.
- Do not add direct third-party model-provider credential env vars.
- Do not add Twilio support in this phase.
- Do not add a Python service.
- Do not put realtime audio sessions inside Next.js request handlers.
- Add a separate LiveKit Agents Node worker process.
- The browser microphone is the first real transport.
- Voice agent tools are conservative only: `create_update`, `request_review`, `mark_contact_attempt`, `schedule_follow_up`, and `add_review_note`.
- The voice agent must not approve, reject, resolve blocked steps, assign owners, or perform arbitrary database writes.
- Preserve the existing simulated voice session path.
- Automated tests must not require LiveKit Cloud credentials.
- Preserve `next build` compatibility without `DATABASE_URL`.
- Do not add direct env var paths for model providers outside LiveKit.

---

## File Structure

- `package.json`: add LiveKit scripts and dependencies.
- `.env.example`: add LiveKit-only env vars.
- `src/db/schema.ts`: add LiveKit metadata columns to `voice_sessions`.
- `drizzle/*`: generated migration metadata.
- `src/modules/livekit/config.ts`: validate LiveKit env and model config.
- `src/modules/livekit/token.ts`: create room names, participant identities, and browser tokens.
- `src/modules/voice/types.ts`: add LiveKit launch/session types.
- `src/modules/voice/store.ts`: persist LiveKit session metadata and query sessions by room.
- `src/modules/voice/session-runner.ts`: keep simulated path unchanged; no LiveKit runtime imports.
- `src/voice-agent/tools.ts`: conservative tool allowlist and workflow tool bridge.
- `src/voice-agent/agent.ts`: LiveKit Agents worker definition using VAD/STT/LLM/TTS through LiveKit.
- `src/voice-agent/start.ts`: worker CLI entrypoint.
- `app/actions/livekit.ts`: server action for LiveKit room/token launch.
- `app/voice/livekit-room.tsx`: client component that joins LiveKit room with mic.
- `app/voice/page.tsx`: add real LiveKit section while retaining simulated section.
- `README.md`: document LiveKit setup and run commands.
- `docs/assignment-note.md`: note that LiveKit browser voice is now the real voice runtime path and Twilio remains future work.
- `tests/livekit-config.test.ts`: config validation.
- `tests/livekit-token.test.ts`: token/room factory behavior with fake or inspectable output.
- `tests/livekit-action.test.ts`: server action derives authoritative workflow context.
- `tests/voice-agent-tools.test.ts`: conservative tool allowlist and routing.
- `tests/voice-store.test.ts`: LiveKit metadata persistence with in-memory/fake store where possible.

---

### Task 1: LiveKit Dependencies, Config, and Schema

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `src/db/schema.ts`
- Create: `src/modules/livekit/config.ts`
- Create: `src/modules/voice/livekit-types.ts`
- Create: `tests/livekit-config.test.ts`
- Create: Drizzle migration files under `drizzle/`

**Interfaces:**
- Produces: `getLiveKitConfig(env?: NodeJS.ProcessEnv): LiveKitConfig`
- Produces: `type LiveKitConfig`
- Produces: `type BrowserVoiceSessionLaunch`
- Produces: `voiceSessions.roomName`, `voiceSessions.participantIdentity`, `voiceSessions.providerSessionId`, `voiceSessions.endedReason`
- Consumes: existing `.env.example`, Drizzle schema, Vitest setup.

- [ ] **Step 1: Add LiveKit dependencies**

Run:

```powershell
npm.cmd install @livekit/agents @livekit/agents-plugin-silero @livekit/agents-plugin-livekit livekit-server-sdk livekit-client @livekit/components-react @livekit/components-styles
```

Expected:

- `package.json` includes the packages above.
- `package-lock.json` updates.
- No direct third-party model-provider SDKs are added.

- [ ] **Step 2: Add scripts**

Modify `package.json` scripts:

```json
{
  "voice:agent": "tsx src/voice-agent/start.ts",
  "voice:agent:dev": "tsx src/voice-agent/start.ts dev"
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Add LiveKit env vars**

Append to `.env.example`:

```text
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_INFERENCE_API_KEY=your_livekit_inference_key
LIVEKIT_AGENT_NAME=hellocouncil-agent
LIVEKIT_STT_MODEL=deepgram/nova-3
LIVEKIT_LLM_MODEL=openai/gpt-4.1-mini
LIVEKIT_TTS_MODEL=cartesia/sonic-3
LIVEKIT_TTS_VOICE=9626c31c-bec5-4cca-baa8-f8ba9e84c8bc
```

Do not add any direct third-party model-provider credential names.

- [ ] **Step 4: Write config tests first**

Create `tests/livekit-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getLiveKitConfig } from "@/modules/livekit/config";

describe("LiveKit config", () => {
  it("loads LiveKit-only runtime configuration", () => {
    const config = getLiveKitConfig({
      LIVEKIT_URL: "wss://example.livekit.cloud",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "secret",
      LIVEKIT_INFERENCE_API_KEY: "inference",
      LIVEKIT_AGENT_NAME: "hellocouncil-agent",
      LIVEKIT_STT_MODEL: "deepgram/nova-3",
      LIVEKIT_LLM_MODEL: "openai/gpt-4.1-mini",
      LIVEKIT_TTS_MODEL: "cartesia/sonic-3",
      LIVEKIT_TTS_VOICE: "voice-id",
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      url: "wss://example.livekit.cloud",
      apiKey: "key",
      apiSecret: "secret",
      inferenceApiKey: "inference",
      agentName: "hellocouncil-agent",
      sttModel: "deepgram/nova-3",
      llmModel: "openai/gpt-4.1-mini",
      ttsModel: "cartesia/sonic-3",
      ttsVoice: "voice-id",
    });
  });

  it("fails with a direct message when required LiveKit config is missing", () => {
    expect(() => getLiveKitConfig({} as NodeJS.ProcessEnv)).toThrow("LIVEKIT_URL is required");
  });
});
```

- [ ] **Step 5: Run config test to verify it fails**

Run:

```powershell
npm.cmd run test:run -- tests/livekit-config.test.ts
```

Expected: fails because `src/modules/livekit/config.ts` does not exist.

- [ ] **Step 6: Implement config module**

Create `src/modules/livekit/config.ts`:

```ts
export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  inferenceApiKey: string;
  agentName: string;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
};

const defaults = {
  agentName: "hellocouncil-agent",
  sttModel: "deepgram/nova-3",
  llmModel: "openai/gpt-4.1-mini",
  ttsModel: "cartesia/sonic-3",
  ttsVoice: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
};

export function getLiveKitConfig(env: NodeJS.ProcessEnv = process.env): LiveKitConfig {
  return {
    url: required(env, "LIVEKIT_URL"),
    apiKey: required(env, "LIVEKIT_API_KEY"),
    apiSecret: required(env, "LIVEKIT_API_SECRET"),
    inferenceApiKey: required(env, "LIVEKIT_INFERENCE_API_KEY"),
    agentName: env.LIVEKIT_AGENT_NAME?.trim() || defaults.agentName,
    sttModel: env.LIVEKIT_STT_MODEL?.trim() || defaults.sttModel,
    llmModel: env.LIVEKIT_LLM_MODEL?.trim() || defaults.llmModel,
    ttsModel: env.LIVEKIT_TTS_MODEL?.trim() || defaults.ttsModel,
    ttsVoice: env.LIVEKIT_TTS_VOICE?.trim() || defaults.ttsVoice,
  };
}

function required(env: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv) {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}
```

- [ ] **Step 7: Add LiveKit launch type**

Create `src/modules/voice/livekit-types.ts`:

```ts
export type BrowserVoiceSessionLaunch = {
  roomName: string;
  participantIdentity: string;
  token: string;
  workflowRunId: string;
  caseId: string;
  livekitUrl: string;
};
```

- [ ] **Step 8: Extend voice session schema**

Modify `voiceSessions` in `src/db/schema.ts`:

```ts
roomName: text("room_name"),
participantIdentity: text("participant_identity"),
providerSessionId: text("provider_session_id"),
endedReason: text("ended_reason"),
```

Keep them nullable for existing simulated sessions.

- [ ] **Step 9: Generate migration**

Run:

```powershell
npm.cmd run db:generate
```

Expected: a new migration is generated under `drizzle/` for the four nullable columns.

- [ ] **Step 10: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/livekit-config.test.ts
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected:

- config tests pass.
- build and lint exit 0.
- no whitespace errors.

- [ ] **Step 11: Commit**

```powershell
git add package.json package-lock.json .env.example src/db/schema.ts src/modules/livekit src/modules/voice/livekit-types.ts tests/livekit-config.test.ts drizzle
git commit -m "feat: add livekit runtime config"
```

---

### Task 2: LiveKit Token Factory and Session Launch Action

**Files:**
- Create: `src/modules/livekit/token.ts`
- Modify: `src/modules/voice/store.ts`
- Create: `app/actions/livekit.ts`
- Create: `tests/livekit-token.test.ts`
- Create: `tests/livekit-action.test.ts`

**Interfaces:**
- Consumes: `getLiveKitConfig`, `BrowserVoiceSessionLaunch`, `DrizzleWorkflowStore.getRun`
- Produces: `createBrowserVoiceSessionLaunch(input): Promise<BrowserVoiceSessionLaunch>`
- Produces: `createLiveKitVoiceSessionAction(formData): Promise<BrowserVoiceSessionLaunch>`
- Produces store method `createLiveKitSession(input): Promise<string>`

- [ ] **Step 1: Write token factory tests**

Create `tests/livekit-token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLiveKitRoomName, createParticipantIdentity } from "@/modules/livekit/token";

describe("LiveKit token helpers", () => {
  it("creates stable, scoped room names for workflow sessions", () => {
    expect(createLiveKitRoomName({ workflowRunId: "run-123" })).toBe("workflow-run-123");
  });

  it("creates participant identities scoped to the workflow run", () => {
    expect(createParticipantIdentity({ workflowRunId: "run-123" })).toBe("browser-run-123");
  });
});
```

- [ ] **Step 2: Run token test to verify it fails**

Run:

```powershell
npm.cmd run test:run -- tests/livekit-token.test.ts
```

Expected: fails because `src/modules/livekit/token.ts` does not exist.

- [ ] **Step 3: Implement token helpers**

Create `src/modules/livekit/token.ts`:

```ts
import { AccessToken } from "livekit-server-sdk";
import type { LiveKitConfig } from "./config";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";

export type LiveKitTokenStore = {
  createLiveKitSession(input: {
    caseId: string;
    workflowRunId: string;
    roomName: string;
    participantIdentity: string;
    providerSessionId?: string;
  }): Promise<string>;
};

export function createLiveKitRoomName(input: { workflowRunId: string }) {
  return `workflow-${input.workflowRunId}`;
}

export function createParticipantIdentity(input: { workflowRunId: string }) {
  return `browser-${input.workflowRunId}`;
}

export async function createBrowserVoiceSessionLaunch(input: {
  config: LiveKitConfig;
  store: LiveKitTokenStore;
  workflowRunId: string;
  caseId: string;
}): Promise<BrowserVoiceSessionLaunch> {
  const roomName = createLiveKitRoomName({ workflowRunId: input.workflowRunId });
  const participantIdentity = createParticipantIdentity({ workflowRunId: input.workflowRunId });
  const token = new AccessToken(input.config.apiKey, input.config.apiSecret, {
    identity: participantIdentity,
    name: "Firm user",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  await input.store.createLiveKitSession({
    caseId: input.caseId,
    workflowRunId: input.workflowRunId,
    roomName,
    participantIdentity,
    providerSessionId: roomName,
  });

  return {
    roomName,
    participantIdentity,
    token: await token.toJwt(),
    workflowRunId: input.workflowRunId,
    caseId: input.caseId,
    livekitUrl: input.config.url,
  };
}
```

- [ ] **Step 4: Add LiveKit session persistence**

Modify `DrizzleVoiceSessionStore` in `src/modules/voice/store.ts`:

```ts
async createLiveKitSession(input: {
  caseId: string;
  workflowRunId: string;
  roomName: string;
  participantIdentity: string;
  providerSessionId?: string;
}) {
  const [session] = await this.client
    .insert(voiceSessions)
    .values({
      caseId: input.caseId,
      workflowRunId: input.workflowRunId,
      provider: "livekit",
      status: "pending",
      roomName: input.roomName,
      participantIdentity: input.participantIdentity,
      providerSessionId: input.providerSessionId,
    })
    .returning({ id: voiceSessions.id });
  return session.id;
}
```

- [ ] **Step 5: Write server action test**

Create `tests/livekit-action.test.ts` using module-level helpers instead of invoking Next internals directly:

```ts
import { describe, expect, it } from "vitest";
import { createBrowserVoiceSessionLaunch } from "@/modules/livekit/token";

describe("LiveKit voice session launch", () => {
  it("persists LiveKit metadata and returns a browser launch payload", async () => {
    const sessions: unknown[] = [];
    const launch = await createBrowserVoiceSessionLaunch({
      config: {
        url: "wss://example.livekit.cloud",
        apiKey: "key",
        apiSecret: "secret",
        inferenceApiKey: "inference",
        agentName: "hellocouncil-agent",
        sttModel: "deepgram/nova-3",
        llmModel: "openai/gpt-4.1-mini",
        ttsModel: "cartesia/sonic-3",
        ttsVoice: "voice-id",
      },
      store: {
        async createLiveKitSession(input) {
          sessions.push(input);
          return "voice-session-1";
        },
      },
      workflowRunId: "run-1",
      caseId: "case-1",
    });

    expect(launch.roomName).toBe("workflow-run-1");
    expect(launch.participantIdentity).toBe("browser-run-1");
    expect(launch.livekitUrl).toBe("wss://example.livekit.cloud");
    expect(launch.token).toEqual(expect.any(String));
    expect(sessions).toEqual([
      expect.objectContaining({
        caseId: "case-1",
        workflowRunId: "run-1",
        roomName: "workflow-run-1",
        participantIdentity: "browser-run-1",
      }),
    ]);
  });
});
```

- [ ] **Step 6: Implement server action**

Create `app/actions/livekit.ts`:

```ts
"use server";

export async function createLiveKitVoiceSessionAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  if (!workflowRunId) throw new Error("workflowRunId is required.");

  const [{ getLiveKitConfig }, { createBrowserVoiceSessionLaunch }, { DrizzleWorkflowStore }, { DrizzleVoiceSessionStore }] =
    await Promise.all([
      import("@/modules/livekit/config"),
      import("@/modules/livekit/token"),
      import("@/modules/workflows/store"),
      import("@/modules/voice/store"),
    ]);

  const workflowStore = new DrizzleWorkflowStore();
  const run = await workflowStore.getRun(workflowRunId);

  return createBrowserVoiceSessionLaunch({
    config: getLiveKitConfig(),
    store: new DrizzleVoiceSessionStore(),
    workflowRunId: run.id,
    caseId: run.caseId,
  });
}
```

- [ ] **Step 7: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/livekit-token.test.ts tests/livekit-action.test.ts
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected: tests, build, lint, and diff-check pass.

- [ ] **Step 8: Commit**

```powershell
git add src/modules/livekit/token.ts src/modules/voice/store.ts app/actions/livekit.ts tests/livekit-token.test.ts tests/livekit-action.test.ts
git commit -m "feat: add livekit session launch"
```

---

### Task 3: Browser LiveKit Room UI

**Files:**
- Create: `app/voice/livekit-room.tsx`
- Modify: `app/voice/page.tsx`
- Modify: `src/modules/dashboard/queries.ts` only if the voice page query needs additional session metadata.
- Create: `tests/livekit-room.test.tsx`

**Interfaces:**
- Consumes: `createLiveKitVoiceSessionAction`
- Produces: browser component `LiveKitVoiceRoom`

- [ ] **Step 1: Add LiveKit component styles**

Modify `app/layout.tsx`:

```tsx
import "@livekit/components-styles";
```

Place it after `import "./globals.css";`.

- [ ] **Step 2: Create client LiveKit room component**

Create `app/voice/livekit-room.tsx`:

```tsx
"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { Mic, PhoneOff } from "lucide-react";
import { useState, useTransition } from "react";
import { createLiveKitVoiceSessionAction } from "@/app/actions/livekit";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";

export function LiveKitVoiceLauncher({ runs }: { runs: Array<{ id: string; title: string; summary: string }> }) {
  const [launch, setLaunch] = useState<BrowserVoiceSessionLaunch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startSession(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        setLaunch(await createLiveKitVoiceSessionAction(formData));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to start LiveKit session.");
      }
    });
  }

  if (launch) {
    return (
      <section className="rounded border border-line bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Live voice session</h2>
            <p className="text-sm text-muted">{launch.roomName}</p>
          </div>
          <button className="rounded border border-line px-3 py-2 text-sm" type="button" onClick={() => setLaunch(null)}>
            <PhoneOff className="inline-block" size={16} /> End view
          </button>
        </div>
        <LiveKitRoom token={launch.token} serverUrl={launch.livekitUrl} connect audio>
          <RoomAudioRenderer />
          <p className="text-sm text-muted">Connected with microphone enabled. Speak to the LiveKit agent worker.</p>
        </LiveKitRoom>
      </section>
    );
  }

  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="font-semibold">Real LiveKit session</h2>
      <p className="text-sm text-muted">Start a browser microphone session for a workflow run.</p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {runs.map((run) => (
          <form key={run.id} action={startSession} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
            <input type="hidden" name="workflowRunId" value={run.id} />
            <p className="font-medium">{run.title}</p>
            <p className="text-sm text-muted">{run.summary}</p>
            <button className="mt-2 rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60" type="submit" disabled={isPending}>
              <Mic className="inline-block" size={16} /> Start LiveKit session
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add browser UI test**

Create `tests/livekit-room.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveKitVoiceLauncher } from "@/../app/voice/livekit-room";

describe("LiveKitVoiceLauncher", () => {
  it("renders workflow runs as real voice session launchers", () => {
    render(<LiveKitVoiceLauncher runs={[{ id: "run-1", title: "Medical follow-up", summary: "Call provider" }]} />);

    expect(screen.getByText("Real LiveKit session")).toBeInTheDocument();
    expect(screen.getByText("Medical follow-up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start livekit session/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Modify voice page**

Modify `app/voice/page.tsx`:

- Import `LiveKitVoiceLauncher`.
- Change title to `Voice sessions`.
- Add a real LiveKit section above the simulated section:

```tsx
<LiveKitVoiceLauncher runs={runs.map((run) => ({ id: run.id, title: run.title, summary: run.summary }))} />
```

- Keep the existing simulated session section but retitle it `Simulated voice session`.

- [ ] **Step 5: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/livekit-room.test.tsx
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected: test, build, lint, and diff-check pass.

- [ ] **Step 6: Commit**

```powershell
git add app/layout.tsx app/voice/page.tsx app/voice/livekit-room.tsx tests/livekit-room.test.tsx
git commit -m "feat: add livekit browser voice UI"
```

---

### Task 4: Conservative Voice Tool Bridge

**Files:**
- Create: `src/voice-agent/tools.ts`
- Create: `tests/voice-agent-tools.test.ts`

**Interfaces:**
- Consumes: `WorkflowEngine`, `routeWorkflowAction`, `workflowDefinitions`
- Produces: `executeVoiceWorkflowTool(input): Promise<{ ok: boolean; message: string }>`
- Produces: `voiceToolNames`

- [ ] **Step 1: Write allowlist and routing tests**

Create `tests/voice-agent-tools.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeVoiceWorkflowTool, voiceToolNames } from "@/voice-agent/tools";
import type { WorkflowRunRecord, WorkflowStore } from "@/modules/workflows/store";

function fakeStore(): WorkflowStore {
  return {
    async getRun(): Promise<WorkflowRunRecord> {
      return {
        id: "run-1",
        definitionId: "medical-records-follow-up",
        caseId: "case-1",
        status: "active",
        title: "Run",
        summary: "",
      };
    },
    async getDueSteps() { return []; },
    async getStep() { throw new Error("unused"); },
    async getReview() { throw new Error("unused"); },
    async isAssignableFirmUser() { return false; },
    async claimDueStep() { return null; },
    async claimDueStepForScheduling() { return false; },
    async markDueStepScheduled() {},
    async releaseDueStepSchedulingClaim() {},
    async updateRunStatus() {},
    async updateStepStatus() {},
    async rescheduleStep() {},
    async updateStepPayload() {},
    async transitionClaimedStepAfterFailure() { return false; },
    async createStep() { throw new Error("unused"); },
    async appendEvent() {},
    async createReview() { return "review-1"; },
    async resolveReview() {},
    async createContactAttempt() {},
    async applyAction(action) { return { ok: true, message: `Applied ${action.type}` }; },
  };
}

describe("voice agent tools", () => {
  it("exposes only conservative workflow tools", () => {
    expect(voiceToolNames).toEqual([
      "create_update",
      "request_review",
      "mark_contact_attempt",
      "schedule_follow_up",
      "add_review_note",
    ]);
  });

  it("rejects blocked-step resolution from voice", async () => {
    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "resolve_blocked_step",
        payload: {},
        store: fakeStore(),
      }),
    ).rejects.toThrow("not allowed for voice agents");
  });

  it("routes allowed create_update through the workflow engine", async () => {
    const store = fakeStore();
    const spy = vi.spyOn(store, "appendEvent");

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "Provider says records are ready." },
      store,
    });

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd run test:run -- tests/voice-agent-tools.test.ts
```

Expected: fails because `src/voice-agent/tools.ts` does not exist.

- [ ] **Step 3: Implement tool bridge**

Create `src/voice-agent/tools.ts`:

```ts
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { workflowDefinitions, getWorkflowDefinition } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore, type WorkflowStore } from "@/modules/workflows/store";
import type { WorkflowAction } from "@/modules/workflows/types";

export const voiceToolNames = [
  "create_update",
  "request_review",
  "mark_contact_attempt",
  "schedule_follow_up",
  "add_review_note",
] as const;

export type VoiceToolName = typeof voiceToolNames[number];

export async function executeVoiceWorkflowTool(input: {
  workflowRunId: string;
  toolName: string;
  payload: unknown;
  store?: WorkflowStore;
}) {
  if (!isVoiceToolName(input.toolName)) {
    throw new Error(`Tool ${input.toolName} is not allowed for voice agents.`);
  }

  const store = input.store ?? new DrizzleWorkflowStore();
  const run = await store.getRun(input.workflowRunId);
  const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });
  const definition = getWorkflowDefinition(run.definitionId);
  const action = toWorkflowAction(input.workflowRunId, input.toolName, input.payload);

  return routeWorkflowAction({ action, definition, engine });
}

function isVoiceToolName(value: string): value is VoiceToolName {
  return (voiceToolNames as readonly string[]).includes(value);
}

function toWorkflowAction(workflowRunId: string, toolName: VoiceToolName, payload: unknown): WorkflowAction {
  const body = objectPayload(payload);
  if (toolName === "create_update") {
    return {
      type: "create_update",
      workflowRunId,
      summary: stringField(body, "summary"),
      source: "voice_session",
    };
  }
  if (toolName === "request_review") {
    return {
      type: "request_review",
      workflowRunId,
      reason: reviewReasonField(body, "reason"),
      summary: stringField(body, "summary"),
    };
  }
  if (toolName === "mark_contact_attempt") {
    return {
      type: "mark_contact_attempt",
      workflowRunId,
      channel: "voice_session",
      outcome: contactOutcomeField(body, "outcome"),
      summary: stringField(body, "summary"),
    };
  }
  if (toolName === "schedule_follow_up") {
    return {
      type: "schedule_follow_up",
      workflowRunId,
      stepType: stringField(body, "stepType"),
      dueAt: new Date(stringField(body, "dueAt")),
      reason: stringField(body, "reason"),
    };
  }
  return {
    type: "add_review_note",
    workflowRunId,
    reviewRequestId: stringField(body, "reviewRequestId"),
    note: stringField(body, "note"),
  };
}

function objectPayload(payload: unknown) {
  if (typeof payload !== "object" || payload === null) throw new Error("Tool payload must be an object.");
  return payload as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function reviewReasonField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  if (
    value === "missing_authorization" ||
    value === "ambiguous_client_response" ||
    value === "provider_refusal" ||
    value === "sensitive_legal_advice" ||
    value === "failed_contact_threshold"
  ) {
    return value;
  }
  throw new Error(`${key} is not a supported review reason.`);
}

function contactOutcomeField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  if (value === "reached" || value === "left_message" || value === "failed" || value === "refused") return value;
  throw new Error(`${key} is not a supported contact outcome.`);
}
```

- [ ] **Step 4: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/voice-agent-tools.test.ts
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected: tests, build, lint, and diff-check pass.

- [ ] **Step 5: Commit**

```powershell
git add src/voice-agent/tools.ts tests/voice-agent-tools.test.ts
git commit -m "feat: add voice workflow tool bridge"
```

---

### Task 5: LiveKit Agents Worker

**Files:**
- Create: `src/voice-agent/agent.ts`
- Create: `src/voice-agent/start.ts`
- Create: `tests/voice-agent-config.test.ts`

**Interfaces:**
- Consumes: `getLiveKitConfig`
- Consumes: `executeVoiceWorkflowTool`
- Produces: LiveKit Agents worker entrypoint for `npm run voice:agent`

- [ ] **Step 1: Write model config test**

Create `tests/voice-agent-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAgentInstructions, createAgentModelConfig } from "@/voice-agent/agent";

describe("voice agent configuration", () => {
  it("uses explicit LiveKit inference model config", () => {
    expect(
      createAgentModelConfig({
        sttModel: "deepgram/nova-3",
        llmModel: "openai/gpt-4.1-mini",
        ttsModel: "cartesia/sonic-3",
        ttsVoice: "voice-id",
      }),
    ).toEqual({
      sttModel: "deepgram/nova-3",
      llmModel: "openai/gpt-4.1-mini",
      ttsModel: "cartesia/sonic-3",
      ttsVoice: "voice-id",
    });
  });

  it("tells the agent to use conservative workflow tools only", () => {
    expect(buildAgentInstructions()).toContain("Do not approve, reject, resolve, or assign legal review requests");
    expect(buildAgentInstructions()).toContain("Use structured workflow tools");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm.cmd run test:run -- tests/voice-agent-config.test.ts
```

Expected: fails because `src/voice-agent/agent.ts` does not exist.

- [ ] **Step 3: Implement agent module**

Create `src/voice-agent/agent.ts`:

```ts
import {
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  llm,
  voice,
  type JobContext,
  type JobProcess,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import * as livekit from "@livekit/agents-plugin-livekit";
import { z } from "zod";
import { getLiveKitConfig, type LiveKitConfig } from "@/modules/livekit/config";
import { executeVoiceWorkflowTool } from "./tools";

export type AgentModelConfig = Pick<LiveKitConfig, "sttModel" | "llmModel" | "ttsModel" | "ttsVoice">;

export function createAgentModelConfig(config: AgentModelConfig) {
  return config;
}

export function buildAgentInstructions() {
  return [
    "You are a legal operations voice agent for HelloCounsel.",
    "Use structured workflow tools for workflow updates, contact attempts, follow-ups, and review notes.",
    "Do not approve, reject, resolve, or assign legal review requests by voice.",
    "Do not give legal advice. If the user asks for legal advice, request human review.",
    "Keep spoken responses concise and confirm what was recorded.",
  ].join(" ");
}

export const workflowTools = {
  create_update: llm.tool({
    description: "Record a factual workflow update from the voice conversation.",
    parameters: z.object({ workflowRunId: z.string(), summary: z.string() }),
    execute: async ({ workflowRunId, summary }) =>
      executeVoiceWorkflowTool({ workflowRunId, toolName: "create_update", payload: { summary } }),
  }),
  request_review: llm.tool({
    description: "Request human review when automation should stop for legal or policy reasons.",
    parameters: z.object({
      workflowRunId: z.string(),
      reason: z.enum([
        "missing_authorization",
        "ambiguous_client_response",
        "provider_refusal",
        "sensitive_legal_advice",
        "failed_contact_threshold",
      ]),
      summary: z.string(),
    }),
    execute: async ({ workflowRunId, reason, summary }) =>
      executeVoiceWorkflowTool({ workflowRunId, toolName: "request_review", payload: { reason, summary } }),
  }),
  mark_contact_attempt: llm.tool({
    description: "Record that the current voice session included a contact attempt.",
    parameters: z.object({
      workflowRunId: z.string(),
      outcome: z.enum(["reached", "left_message", "failed", "refused"]),
      summary: z.string(),
    }),
    execute: async ({ workflowRunId, outcome, summary }) =>
      executeVoiceWorkflowTool({ workflowRunId, toolName: "mark_contact_attempt", payload: { outcome, summary } }),
  }),
  schedule_follow_up: llm.tool({
    description: "Schedule a follow-up workflow step.",
    parameters: z.object({
      workflowRunId: z.string(),
      stepType: z.string(),
      dueAt: z.string(),
      reason: z.string(),
    }),
    execute: async ({ workflowRunId, stepType, dueAt, reason }) =>
      executeVoiceWorkflowTool({ workflowRunId, toolName: "schedule_follow_up", payload: { stepType, dueAt, reason } }),
  }),
  add_review_note: llm.tool({
    description: "Add a note to an existing human review request without resolving it.",
    parameters: z.object({ workflowRunId: z.string(), reviewRequestId: z.string(), note: z.string() }),
    execute: async ({ workflowRunId, reviewRequestId, note }) =>
      executeVoiceWorkflowTool({ workflowRunId, toolName: "add_review_note", payload: { reviewRequestId, note } }),
  }),
};

export function createLiveKitAgent() {
  return defineAgent({
    prewarm: async (proc: JobProcess) => {
      proc.userData.vad = await silero.VAD.load();
    },
    entry: async (ctx: JobContext) => {
      const config = getLiveKitConfig();
      await ctx.connect();
      const agent = new voice.Agent({
        instructions: buildAgentInstructions(),
        tools: workflowTools,
      });
      const session = new voice.AgentSession({
        stt: new inference.STT({ model: config.sttModel, language: "en" }),
        llm: new inference.LLM({ model: config.llmModel }),
        tts: new inference.TTS({ model: config.ttsModel, voice: config.ttsVoice }),
        vad: ctx.proc.userData.vad as silero.VAD,
        turnDetection: new livekit.turnDetector.MultilingualModel(),
      });
      await session.start({ agent, room: ctx.room });
      await session.generateReply({
        instructions: "Greet the user and ask what workflow update they want to record.",
      });
    },
  });
}

export function runVoiceAgentCli(agentFile: string) {
  cli.runApp(new WorkerOptions({ agent: agentFile }));
}
```

- [ ] **Step 4: Implement worker start file**

Create `src/voice-agent/start.ts`:

```ts
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createLiveKitAgent, runVoiceAgentCli } from "./agent";

export default createLiveKitAgent();

runVoiceAgentCli(fileURLToPath(import.meta.url));
```

- [ ] **Step 5: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/voice-agent-config.test.ts tests/voice-agent-tools.test.ts
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected: tests, build, lint, and diff-check pass.

- [ ] **Step 6: Commit**

```powershell
git add src/voice-agent/agent.ts src/voice-agent/start.ts tests/voice-agent-config.test.ts
git commit -m "feat: add livekit voice agent worker"
```

---

### Task 6: Voice Session Metadata, Event Rendering, and Docs

**Files:**
- Modify: `src/modules/dashboard/queries.ts`
- Modify: `app/voice/page.tsx`
- Modify: `README.md`
- Modify: `docs/assignment-note.md`
- Create: `tests/voice-console-livekit.test.ts`

**Interfaces:**
- Consumes: LiveKit voice session metadata columns.
- Produces: UI visibility for LiveKit sessions and setup docs.

- [ ] **Step 1: Add voice console query expectations**

Create `tests/voice-console-livekit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { voiceSessionLabel } from "@/modules/dashboard/queries";

describe("voice console LiveKit labels", () => {
  it("includes LiveKit room metadata when available", () => {
    expect(
      voiceSessionLabel({
        provider: "livekit",
        status: "running",
        roomName: "workflow-run-1",
        startedAt: new Date("2026-08-23T00:00:00.000Z"),
      }),
    ).toBe("livekit - running - workflow-run-1");
  });
});
```

- [ ] **Step 2: Implement label helper**

Modify `src/modules/dashboard/queries.ts`:

```ts
export function voiceSessionLabel(session: {
  provider: string;
  status: string;
  roomName?: string | null;
  startedAt: Date;
}) {
  const room = session.roomName ? ` - ${session.roomName}` : "";
  return `${session.provider} - ${session.status}${room}`;
}
```

Use this helper in `app/voice/page.tsx` for recent sessions.

- [ ] **Step 3: Update voice page copy**

Modify `app/voice/page.tsx`:

- Title: `Voice sessions`
- Add text that real LiveKit sessions require `npm run voice:agent` and LiveKit env vars.
- Keep simulated sessions as deterministic fallback.
- Recent session rows should show `roomName` when present.

- [ ] **Step 4: Update README**

Add LiveKit setup section:

```md
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
```

- [ ] **Step 5: Update assignment note**

Modify `docs/assignment-note.md`:

- Move “Real voice-agent runtime” out of `Stubbed` if it is still listed.
- Add “LiveKit browser voice runtime” to implemented.
- Keep “Twilio phone calls” as future work.
- State that this phase uses LiveKit Cloud/Inference only.

- [ ] **Step 6: Verify task**

Run:

```powershell
npm.cmd run test:run -- tests/voice-console-livekit.test.ts
npm.cmd run test:run
npm.cmd run build
npm.cmd run lint
git diff --check
```

Expected: all tests, build, lint, and diff-check pass.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/dashboard/queries.ts app/voice/page.tsx README.md docs/assignment-note.md tests/voice-console-livekit.test.ts
git commit -m "docs: document livekit voice runtime"
```

---

### Task 7: Final Verification and Manual Runbook

**Files:**
- Modify only files required to fix verification failures.

**Interfaces:**
- Consumes all previous LiveKit voice runtime tasks.
- Produces verified code and manual run instructions.

- [ ] **Step 1: Run full tests**

Run:

```powershell
npm.cmd run test:run
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm.cmd run lint
```

Expected: exits 0.

- [ ] **Step 3: Run build**

Run:

```powershell
npm.cmd run build
```

Expected: exits 0. The existing non-fatal Next ESLint-plugin warning may still appear.

- [ ] **Step 4: Check no forbidden provider env vars were added**

Run:

```powershell
$forbiddenProviderKeys = @("OPENAI", "DEEPGRAM", "CARTESIA", "ELEVENLABS") | ForEach-Object { "$($_)_API_KEY" }
Select-String -Path .env.example,README.md,docs\assignment-note.md,docs\superpowers\specs\2026-08-23-livekit-voice-agent-runtime-design.md -Pattern $forbiddenProviderKeys
```

Expected: no matches.

- [ ] **Step 5: Check git state**

Run:

```powershell
git status --short
git diff --check
```

Expected:

- no unintended untracked/tracked files.
- no whitespace errors.

- [ ] **Step 6: Manual LiveKit runbook**

Record in the final task report:

```powershell
Copy-Item .env.example .env
# Fill LIVEKIT_* values and DATABASE_URL
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

Second terminal:

```powershell
npm run worker
```

Third terminal:

```powershell
npm run voice:agent
```

Then open:

```text
http://localhost:3000/voice
```

Expected manual behavior:

- Real LiveKit launcher appears.
- Starting a session asks for microphone permission.
- Browser joins LiveKit room.
- Voice agent worker joins and speaks.
- Session/tool events persist and appear in recent session events.

- [ ] **Step 7: Commit final fixes if any**

If verification required fixes:

```powershell
git add .
git commit -m "fix: verify livekit voice runtime"
```

If no fixes were required, do not create an empty commit.

---

## References

- LiveKit Agents Node.js docs: `https://docs.livekit.io/reference/agents-js/`
- LiveKit Inference models overview: `https://docs.livekit.io/agents/integrations/plugins/`
- LiveKit React component docs: `https://docs.livekit.io/reference/components/react/component/livekitroom/`
- LiveKit React installation docs: `https://docs.livekit.io/reference/components/react/installation/`
