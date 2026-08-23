// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createBrowserVoiceSessionLaunch } from "@/modules/livekit/token";

describe("LiveKit voice session launch", () => {
  it("persists room context before dispatch and records the dispatch id afterward", async () => {
    const operations: string[] = [];
    const dispatches: unknown[] = [];
    const sessions: unknown[] = [];
    const providerSessionUpdates: unknown[] = [];
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
      dispatcher: {
        async createDispatch(roomName, agentName) {
          operations.push("dispatch");
          dispatches.push({ roomName, agentName });
          return { id: "dispatch-1" };
        },
      },
      store: {
        async createLiveKitSession(input) {
          operations.push("create-session");
          sessions.push(input);
          return "voice-session-1";
        },
        async updateLiveKitSessionProviderSessionId(voiceSessionId, providerSessionId) {
          operations.push("update-provider-session-id");
          providerSessionUpdates.push({ voiceSessionId, providerSessionId });
        },
      },
      workflowRunId: "run-1",
      caseId: "case-1",
    });

    expect(launch.roomName).toBe("workflow-run-1");
    expect(launch.participantIdentity).toBe("browser-run-1");
    expect(launch.livekitUrl).toBe("wss://example.livekit.cloud");
    expect(launch.token).toEqual(expect.any(String));
    expect(dispatches).toEqual([
      { roomName: "workflow-run-1", agentName: "hellocouncil-agent" },
    ]);
    expect(sessions).toEqual([
      {
        caseId: "case-1",
        workflowRunId: "run-1",
        roomName: "workflow-run-1",
        participantIdentity: "browser-run-1",
      },
    ]);
    expect(providerSessionUpdates).toEqual([
      { voiceSessionId: "voice-session-1", providerSessionId: "dispatch-1" },
    ]);
    expect(operations).toEqual([
      "create-session",
      "dispatch",
      "update-provider-session-id",
    ]);
  });
});
