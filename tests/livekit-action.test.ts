// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createBrowserVoiceSessionLaunch } from "@/modules/livekit/token";
import { createValidatedLiveKitVoiceSession } from "@/modules/livekit/orchestration";

const config = {
  url: "wss://example.livekit.cloud",
  apiKey: "key",
  apiSecret: "secret",
  inferenceApiKey: "inference",
  agentName: "hellocouncil-agent",
  sttModel: "deepgram/nova-3",
  llmModel: "openai/gpt-4.1-mini",
  ttsModel: "cartesia/sonic-3",
  ttsVoice: "voice-id",
};

describe("LiveKit voice session launch", () => {
  it("persists room context before dispatch and records the dispatch id afterward", async () => {
    const operations: string[] = [];
    const dispatches: unknown[] = [];
    const sessions: unknown[] = [];
    const providerSessionUpdates: unknown[] = [];
    const launch = await createBrowserVoiceSessionLaunch({
      config,
      createLaunchId: () => "launch-1",
      dispatcher: {
        async createDispatch(roomName, agentName, options) {
          operations.push("dispatch");
          dispatches.push({ roomName, agentName, options });
          return { id: "dispatch-1" };
        },
        async deleteDispatch() {},
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
        async finalizeLiveKitSession() {
          return true;
        },
        async appendSessionEvent() {},
      },
      workflowRunId: "run-1",
      caseId: "case-1",
    });

    expect(launch.launchId).toBe("launch-1");
    expect(launch.roomName).toBe("workflow-run-1-launch-1");
    expect(launch.participantIdentity).toBe("browser-run-1-launch-1");
    expect(launch.livekitUrl).toBe("wss://example.livekit.cloud");
    expect(launch.token).toEqual(expect.any(String));
    expect(dispatches).toEqual([
      {
        roomName: "workflow-run-1-launch-1",
        agentName: "hellocouncil-agent",
        options: {
          metadata: JSON.stringify({
            version: 1,
            voiceSessionId: "voice-session-1",
            launchId: "launch-1",
            roomName: "workflow-run-1-launch-1",
          }),
        },
      },
    ]);
    expect(sessions).toEqual([
      {
        caseId: "case-1",
        workflowRunId: "run-1",
        launchId: "launch-1",
        roomName: "workflow-run-1-launch-1",
        participantIdentity: "browser-run-1-launch-1",
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

  it("creates distinct rooms and participant identities for repeated workflow launches", async () => {
    const launches = ["launch-1", "launch-2"];
    const sessions: Array<Record<string, unknown>> = [];
    const store = {
      async createLiveKitSession(input: Record<string, unknown>) {
        sessions.push(input);
        return `voice-${sessions.length}`;
      },
      async updateLiveKitSessionProviderSessionId() {},
      async finalizeLiveKitSession() {
        return true;
      },
      async appendSessionEvent() {},
    };
    const dispatcher = {
      async createDispatch() {
        return { id: `dispatch-${sessions.length}` };
      },
      async deleteDispatch() {},
    };

    const first = await createBrowserVoiceSessionLaunch({
      config,
      store,
      dispatcher,
      workflowRunId: "run-1",
      caseId: "case-1",
      createLaunchId: () => launches.shift()!,
    });
    const second = await createBrowserVoiceSessionLaunch({
      config,
      store,
      dispatcher,
      workflowRunId: "run-1",
      caseId: "case-1",
      createLaunchId: () => launches.shift()!,
    });

    expect(first.roomName).not.toBe(second.roomName);
    expect(first.participantIdentity).not.toBe(second.participantIdentity);
  });

  it("marks a created session failed when dispatch creation fails", async () => {
    const finalizations: unknown[] = [];
    const events: unknown[] = [];
    const store = {
      async createLiveKitSession() {
        return "voice-1";
      },
      async updateLiveKitSessionProviderSessionId() {},
      async finalizeLiveKitSession(...args: unknown[]) {
        finalizations.push(args);
        return true;
      },
      async appendSessionEvent(input: unknown) {
        events.push(input);
      },
    };

    await expect(
      createBrowserVoiceSessionLaunch({
        config,
        store,
        dispatcher: {
          async createDispatch() {
            throw new Error("LiveKit dispatch endpoint unavailable");
          },
          async deleteDispatch() {},
        },
        workflowRunId: "run-1",
        caseId: "case-1",
        createLaunchId: () => "launch-1",
      }),
    ).rejects.toThrow("LiveKit dispatch endpoint unavailable");

    expect(finalizations).toEqual([["voice-1", "failed", "dispatch_failed"]]);
    expect(events).toEqual([
      expect.objectContaining({
        voiceSessionId: "voice-1",
        type: "session.failed",
        payload: { reason: "dispatch_failed" },
      }),
    ]);
  });

  it("deletes a created dispatch when a later launch step fails", async () => {
    const deleted: unknown[] = [];
    const store = {
      async createLiveKitSession() {
        return "voice-1";
      },
      async updateLiveKitSessionProviderSessionId() {
        throw new Error("database write failed");
      },
      async finalizeLiveKitSession() {
        return true;
      },
      async appendSessionEvent() {},
    };

    await expect(
      createBrowserVoiceSessionLaunch({
        config,
        store,
        dispatcher: {
          async createDispatch() {
            return { id: "dispatch-1" };
          },
          async deleteDispatch(dispatchId, roomName) {
            deleted.push({ dispatchId, roomName });
          },
        },
        workflowRunId: "run-1",
        caseId: "case-1",
        createLaunchId: () => "launch-1",
      }),
    ).rejects.toThrow("database write failed");

    expect(deleted).toEqual([
      { dispatchId: "dispatch-1", roomName: "workflow-run-1-launch-1" },
    ]);
  });

  it("validates the persisted workflow definition before launching", async () => {
    let launched = false;

    await expect(
      createValidatedLiveKitVoiceSession({
        workflowRunId: "run-1",
        workflowStore: {
          async getRun() {
            return {
              id: "run-1",
              definitionId: "removed-definition" as "medical-records-follow-up",
              caseId: "case-1",
              status: "active",
              title: "Run",
              summary: "",
            };
          },
        },
        async launch() {
          launched = true;
          throw new Error("should not launch");
        },
      }),
    ).rejects.toThrow("Unknown workflow definition: removed-definition");

    expect(launched).toBe(false);
  });
});
