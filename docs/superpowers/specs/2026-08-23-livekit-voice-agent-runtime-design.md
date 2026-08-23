# LiveKit Voice Agent Runtime Design

Date: 2026-08-23

## Goal

Add a real streaming voice-agent runtime to the existing long-running legal workflow platform.

This phase is LiveKit-only. It does not add direct OpenAI, Deepgram, Cartesia, ElevenLabs, or Twilio provider integrations. The runtime will use LiveKit Cloud and LiveKit Agents with LiveKit Inference/model configuration for the first real agent path.

The result should let a browser user start a real microphone session for a workflow run, speak with an agent, and have the agent call controlled workflow tools that route through the existing workflow platform.

## Non-Goals

- No Twilio call support in this phase.
- No direct third-party model-provider credential env vars.
- No Python service.
- No full call-center console.
- No broad redesign of the existing workflow engine, dashboard, or review queue.
- No agent permission to approve, reject, or resolve legal review blocks by voice.

## Current State

The platform currently has:

- A simulated voice adapter that emits deterministic transcript chunks and a structured `create_update` tool call.
- `runVoiceSession`, which persists session lifecycle, transcript events, tool calls, tool results, and failures.
- `DrizzleVoiceSessionStore`, which writes to `voice_sessions` and `voice_session_events`.
- `runSimulatedVoiceSessionAction`, which loads the persisted workflow run, derives its workflow definition, and routes structured actions through `routeWorkflowAction` and `WorkflowEngine`.

The missing piece is a real streaming media runtime. The existing `VoiceSessionAdapter` is shaped around pull-style async events, which is enough for simulation but too shallow for a bidirectional realtime agent that must manage room joins, streaming audio, interruption, and tool calls.

## Chosen Architecture

Use a separate LiveKit Agents Node worker as the voice runtime.

```text
Browser microphone
  -> LiveKit Cloud room
  -> LiveKit Agents Node worker
  -> LiveKit VAD / turn detection
  -> LiveKit Inference STT
  -> LiveKit Inference LLM with workflow tools
  -> LiveKit Inference TTS
  -> LiveKit room audio response
  -> persisted voice session events
  -> structured workflow actions
  -> WorkflowEngine
```

The Next.js app remains the workflow platform and browser UI. The LiveKit worker runs as a separate process because realtime audio sessions should not live inside request/response handlers.

## Runtime Modules

Add:

- `src/voice-agent/config.ts`
- `src/voice-agent/livekit.ts`
- `src/voice-agent/tools.ts`
- `src/voice-agent/agent.ts`
- `src/voice-agent/start.ts`

Extend:

- `src/modules/voice/types.ts`
- `src/modules/voice/store.ts`
- `src/modules/voice/session-runner.ts`
- `app/actions/livekit.ts`
- `app/voice/page.tsx`

## Interfaces and Seams

### LiveKit Room Session Interface

The browser session launcher should not know LiveKit implementation details beyond receiving a room name, participant identity, and token.

Proposed interface:

```ts
export type BrowserVoiceSessionLaunch = {
  roomName: string;
  participantIdentity: string;
  token: string;
  workflowRunId: string;
  caseId: string;
};
```

Server action:

```ts
createLiveKitVoiceSessionAction(formData: FormData): Promise<BrowserVoiceSessionLaunch>
```

Authoritative inputs:

- Form posts only `workflowRunId`.
- Server loads the workflow run from the database.
- Server derives `caseId` and `definitionId` from the persisted workflow run.
- Server creates/persists a `voice_sessions` row before issuing the browser token.

### Voice Agent Tool Interface

The agent may call only conservative workflow tools:

- `create_update`
- `request_review`
- `mark_contact_attempt`
- `schedule_follow_up`
- `add_review_note`

The voice agent must not call:

- approve
- reject
- resolve blocked step
- assign owner
- arbitrary database writes

Those remain human-review UI actions.

Tool bridge:

```ts
executeVoiceWorkflowTool(input: {
  workflowRunId: string;
  toolName: string;
  payload: unknown;
}): Promise<{ ok: boolean; message: string }>;
```

Implementation rules:

- Validate tool name against the conservative voice tool allowlist.
- Convert tool payload to a typed `WorkflowAction`.
- Load the workflow run.
- Get the workflow definition from the central registry.
- Route through `routeWorkflowAction`.
- Persist tool call and tool result events.

### Agent Runtime Interface

The LiveKit worker should own realtime media details:

- connect to LiveKit Cloud
- register an agent worker
- join dispatched rooms
- configure VAD / STT / LLM / TTS through LiveKit
- expose workflow tools to the LLM
- persist transcript and tool events
- fail sessions cleanly

Next.js should not import agent runtime code. Shared code flows from platform modules into the worker, not the reverse.

## Environment

Add LiveKit-only env vars:

```text
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_INFERENCE_API_KEY=
LIVEKIT_AGENT_NAME=hellocouncil-agent
```

Do not add direct third-party model-provider credential paths in this phase. If LiveKit Inference later requires model-specific routing values, they should be represented as LiveKit config values, not direct third-party credentials.

## Scripts

Add:

```json
{
  "voice:agent": "tsx src/voice-agent/start.ts"
}
```

Local run shape:

```powershell
npm run dev
npm run voice:agent
```

The user opens `/voice`, selects a workflow run, and starts a LiveKit browser session.

## Browser Voice Page

The `/voice` page should evolve from simulated-only to two explicit sections:

1. Real LiveKit session launcher
2. Existing simulated session launcher for deterministic local testing

Real session launcher:

- lists workflow runs
- starts a LiveKit room/token for the selected run
- joins with browser microphone
- shows connection status
- shows recent persisted session events

The first UI should stay operational and compact. Do not build a full call-center console.

## Database Changes

Extend `voice_sessions` with LiveKit metadata:

- `roomName`
- `participantIdentity`
- `providerSessionId`
- `endedReason`

Keep `voice_session_events` as the event log for:

- `session.started`
- `participant.connected`
- `transcript_chunk`
- `tool_call`
- `tool_result`
- `session.completed`
- `session.failed`

The schema should remain provider-neutral enough that Twilio can later add `callSid` / `streamSid` without replacing LiveKit fields. Provider-specific values can also go into event payloads when they are not query-critical.

## Data Flow

### Starting a Real Browser Voice Session

1. User chooses a workflow run on `/voice`.
2. Server action receives `workflowRunId`.
3. Server loads the run and case from the DB.
4. Server creates a LiveKit room name and browser participant identity.
5. Server creates/persists a `voice_sessions` row with provider `livekit`.
6. Server returns a LiveKit browser token.
7. Browser joins the room with microphone enabled.
8. LiveKit dispatches or allows the agent worker to join the same room.

### Agent Conversation

1. LiveKit worker receives streaming audio.
2. LiveKit VAD / turn detection determines user turns.
3. LiveKit STT streams transcript into the agent.
4. LLM decides either to respond or call one of the allowed workflow tools.
5. Tool calls route through `executeVoiceWorkflowTool`.
6. Tool bridge calls `routeWorkflowAction`.
7. `WorkflowEngine` writes workflow state and audit events.
8. Tool result is returned to the LLM and persisted.
9. TTS streams the response back into the LiveKit room.

## Error Handling

- If token creation fails, no browser join should occur.
- If agent runtime fails during a session, mark the persisted voice session `failed` and append `session.failed`.
- If a tool call fails, persist a `tool_result` with `ok: false` and a safe error message.
- If the workflow run no longer exists or its definition is unknown, fail before joining the LiveKit room.
- If LiveKit credentials are missing, startup should fail with a direct configuration error.
- If the agent tries a disallowed tool, reject it and persist a failed tool result.

## Testing Strategy

Use fake LiveKit adapters where possible. Do not require real LiveKit Cloud in automated tests.

Tests:

- LiveKit config validation requires only LiveKit env vars.
- `createLiveKitVoiceSessionAction` derives case and definition from persisted workflow run.
- Browser token creation can be tested through a fake token factory.
- Voice tool allowlist rejects review-resolution actions.
- Voice tool bridge routes allowed actions through `routeWorkflowAction`.
- LiveKit session metadata is persisted.
- Simulated voice path remains working.
- `npm run test:run`, `npm run lint`, and `npm run build` pass.

Manual verification with real LiveKit Cloud:

1. Add LiveKit env vars.
2. Start app.
3. Start voice agent worker.
4. Open `/voice`.
5. Start a real session for a workflow run.
6. Speak into browser microphone.
7. Confirm transcript/tool events persist.
8. Confirm workflow audit events update.

## Rollout Plan

1. Add dependencies and LiveKit env config.
2. Add voice session metadata columns and migration.
3. Add server action for LiveKit room/token launch.
4. Add browser LiveKit join UI.
5. Add LiveKit worker entrypoint.
6. Add conservative workflow tool bridge.
7. Persist agent transcript/tool events.
8. Keep simulated session as deterministic fallback.
9. Add tests and docs.

## Open Risks

- Exact LiveKit Inference model names and defaults may need adjustment against the installed LiveKit Agents package.
- Browser microphone permissions and HTTPS requirements may require a tunnel or deployed app for real testing.
- Real latency, interruption quality, and turn-taking can only be validated with LiveKit Cloud credentials.
- The current local environment still needs working Postgres/Docker before the full app can be exercised end to end.

## Decision Summary

- LiveKit Agents Node.js: chosen for a production-grade streaming agent runtime that fits the TypeScript repo.
- Explicit pipeline: chosen because the user wants VAD, STT, LLM, and TTS as visible runtime pieces.
- Separate worker process: chosen because realtime audio does not belong in Next.js request handlers.
- Browser microphone first: chosen to prove real voice before Twilio transport.
- Structured tools only: chosen to preserve auditability and legal safety.
- LiveKit-only credentials: chosen to avoid provider-specific setup until the LiveKit runtime works.
