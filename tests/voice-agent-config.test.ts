import { describe, expect, it } from "vitest";
import {
  buildAgentInstructions,
  createAgentModelConfig,
  createWorkflowTools,
  requireLiveKitRoomName,
  resolveVoiceWorkflowContext,
  type VoiceSessionLookup,
} from "@/voice-agent/agent";
import type { VoiceToolEventStore } from "@/voice-agent/tools";

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
    expect(buildAgentInstructions()).toContain(
      "Do not approve, reject, resolve, or assign legal review requests",
    );
    expect(buildAgentInstructions()).toContain("Use structured workflow tools");
  });

  it("resolves workflow and event persistence context from the LiveKit room", async () => {
    const store: VoiceSessionLookup = {
      async getLiveKitSessionByRoomName(roomName) {
        expect(roomName).toBe("workflow-run-1");
        return { id: "voice-1", workflowRunId: "run-1", caseId: "case-1" };
      },
      async appendSessionEvent() {},
    };

    await expect(resolveVoiceWorkflowContext("workflow-run-1", store)).resolves.toEqual({
      workflowRunId: "run-1",
      voiceSessionId: "voice-1",
      voiceEventStore: store,
    });
  });

  it("rejects rooms without a persisted LiveKit voice session", async () => {
    const store: VoiceSessionLookup = {
      async getLiveKitSessionByRoomName() {
        return null;
      },
      async appendSessionEvent() {},
    };

    await expect(resolveVoiceWorkflowContext("unknown-room", store)).rejects.toThrow(
      "No persisted LiveKit voice session found for room unknown-room.",
    );
  });

  it("requires the connected LiveKit room to have a name", () => {
    expect(() => requireLiveKitRoomName(undefined)).toThrow(
      "Connected LiveKit room is missing its name.",
    );
    expect(requireLiveKitRoomName("workflow-run-1")).toBe("workflow-run-1");
  });

  it("forwards persisted event context for every conservative workflow tool", async () => {
    const voiceEventStore: VoiceToolEventStore = { async appendSessionEvent() {} };
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
