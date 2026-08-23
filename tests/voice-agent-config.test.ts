import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAgentInstructions,
  createAgentModelConfig,
  createVoiceAgentServerOptions,
  createWorkflowTools,
  requireLiveKitRoomName,
  resolveVoiceWorkflowContext,
  type VoiceSessionLookup,
} from "@/voice-agent/agent";
import type { VoiceToolEventStore } from "@/voice-agent/tools";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";

describe("voice agent configuration", () => {
  it("starts the worker in production and development CLI modes", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["voice:agent"]).toBe("tsx src/voice-agent/start.ts start");
    expect(packageJson.scripts["voice:agent:dev"]).toBe("tsx src/voice-agent/start.ts dev");
  });

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

  it("passes validated LiveKit config to the worker server options", () => {
    const options = createVoiceAgentServerOptions("agent-file.ts", {
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

    expect(options).toMatchObject({
      agent: "agent-file.ts",
      agentName: "hellocouncil-agent",
      wsURL: "wss://example.livekit.cloud",
      apiKey: "key",
      apiSecret: "secret",
    });
  });

  it("tells the agent to use conservative workflow tools only", () => {
    expect(buildAgentInstructions()).toContain(
      "Do not approve, reject, resolve, or assign legal review requests",
    );
    expect(buildAgentInstructions()).toContain("Use structured workflow tools");
  });

  it("resolves the exact persisted launch and workflow definition from dispatch metadata", async () => {
    const operations: string[] = [];
    const store: VoiceSessionLookup = {
      async getLiveKitSessionById(voiceSessionId) {
        operations.push("session");
        expect(voiceSessionId).toBe("voice-1");
        return {
          id: "voice-1",
          launchId: "launch-1",
          workflowRunId: "run-1",
          caseId: "case-1",
          roomName: "workflow-run-1-launch-1",
          participantIdentity: "browser-run-1-launch-1",
          status: "pending",
        };
      },
      async appendSessionEvent() {},
      async claimToolCall() {
        return true;
      },
      async getToolCallResult() {
        return null;
      },
    };

    await expect(
      resolveVoiceWorkflowContext({
        dispatchMetadata: JSON.stringify({
          version: 1,
          voiceSessionId: "voice-1",
          launchId: "launch-1",
          roomName: "workflow-run-1-launch-1",
        }),
        roomName: "workflow-run-1-launch-1",
        voiceStore: store,
        workflowStore: {
          async getRun(id) {
            operations.push("workflow");
            expect(id).toBe("run-1");
            return {
              id: "run-1",
              definitionId: "medical-records-follow-up",
              caseId: "case-1",
              status: "active",
              title: "Run",
              summary: "",
            };
          },
        },
        getDefinition(id) {
          operations.push("definition");
          return getWorkflowDefinition(id);
        },
      }),
    ).resolves.toEqual({
      workflowRunId: "run-1",
      voiceSessionId: "voice-1",
      participantIdentity: "browser-run-1-launch-1",
      voiceEventStore: store,
    });
    expect(operations).toEqual(["session", "workflow", "definition"]);
  });

  it("rejects dispatch metadata without an exact persisted LiveKit voice session", async () => {
    const store: VoiceSessionLookup = {
      async getLiveKitSessionById() {
        return null;
      },
      async appendSessionEvent() {},
      async claimToolCall() {
        return true;
      },
      async getToolCallResult() {
        return null;
      },
    };

    await expect(
      resolveVoiceWorkflowContext({
        dispatchMetadata: JSON.stringify({
          version: 1,
          voiceSessionId: "voice-missing",
          launchId: "launch-1",
          roomName: "workflow-run-1-launch-1",
        }),
        roomName: "workflow-run-1-launch-1",
        voiceStore: store,
        workflowStore: { async getRun() { throw new Error("should not read run"); } },
      }),
    ).rejects.toThrow("No persisted LiveKit voice session found for id voice-missing.");
  });

  it("requires the connected LiveKit room to have a name", () => {
    expect(() => requireLiveKitRoomName(undefined)).toThrow(
      "Connected LiveKit room is missing its name.",
    );
    expect(requireLiveKitRoomName("workflow-run-1-launch-1")).toBe(
      "workflow-run-1-launch-1",
    );
  });

  it("forwards persisted event context for every conservative workflow tool", async () => {
    const voiceEventStore: VoiceToolEventStore = {
      async appendSessionEvent() {},
      async claimToolCall() {
        return true;
      },
      async getToolCallResult() {
        return null;
      },
    };
    const calls: Array<Record<string, unknown>> = [];
    const workflowTools = createWorkflowTools(
      {
        workflowRunId: "run-1",
        voiceSessionId: "voice-1",
        voiceEventStore,
      },
      async (input) => {
        calls.push(input);
        return { ok: true, message: "Recorded." };
      },
    );
    const toolCases = [
      ["create_update", { summary: "Records are ready." }],
      [
        "request_review",
        { reason: "provider_refusal", summary: "The provider refused the request." },
      ],
      [
        "mark_contact_attempt",
        { outcome: "reached", summary: "Reached the records department." },
      ],
      [
        "schedule_follow_up",
        {
          stepType: "provider_follow_up",
          dueAt: "2026-08-24T10:00:00.000Z",
          reason: "Call again tomorrow.",
        },
      ],
      [
        "add_review_note",
        { reviewRequestId: "review-1", note: "Waiting for authorization." },
      ],
    ] as const;

    expect(Object.keys(workflowTools)).toEqual(toolCases.map(([toolName]) => toolName));

    for (const [toolName, payload] of toolCases) {
      const tool = workflowTools[toolName];
      await tool.execute(payload, {
        abortSignal: new AbortController().signal,
        ctx: {} as never,
        toolCallId: `call-${toolName}`,
      });
    }

    expect(calls).toEqual(
      toolCases.map(([toolName, payload]) => ({
        workflowRunId: "run-1",
        toolName,
        payload,
        voiceEventStore,
        voiceSessionId: "voice-1",
        toolCallId: `call-${toolName}`,
      })),
    );
  });
});
