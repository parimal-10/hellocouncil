import { describe, expect, it, vi } from "vitest";
import {
  executeVoiceWorkflowTool,
  voiceToolNames,
  type VoiceToolEventStore,
} from "@/voice-agent/tools";
import type { WorkflowRunRecord } from "@/modules/workflows/store";
import { TestWorkflowStore } from "./test-store";

function storeWithRun(id = "run-1") {
  const store = new TestWorkflowStore();
  const run: WorkflowRunRecord = {
    id,
    definitionId: "medical-records-follow-up",
    caseId: "case-1",
    status: "active",
    title: "Medical records follow-up",
    summary: "",
  };
  store.runs.set(id, run);
  return store;
}

function addOpenReview(store: TestWorkflowStore, workflowRunId = "run-1") {
  store.reviews.push({
    id: "review-1",
    workflowRunId,
    status: "open",
    decision: {
      kind: "block",
      reason: "provider_refusal",
      severity: "high",
      recommendedAction: "Review the provider response.",
      summary: "Provider refused the request.",
    },
  });
}

function recordingEventStore() {
  const events: Array<Record<string, unknown>> = [];
  const store: VoiceToolEventStore = {
    async appendSessionEvent(input) {
      events.push(input);
    },
  };
  return { events, store };
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

  it("rejects blocked-step resolution before reading workflow state", async () => {
    const store = storeWithRun();
    const getRun = vi.spyOn(store, "getRun");

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "resolve_blocked_step",
        payload: {},
        store,
      }),
    ).rejects.toThrow("Tool resolve_blocked_step is not allowed for voice agents.");

    expect(getRun).not.toHaveBeenCalled();
  });

  it("routes create_update through the workflow engine as a voice action", async () => {
    const store = storeWithRun();

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "  Provider says records are ready.  " },
      store,
    });

    expect(result).toEqual({ ok: true, message: "Workflow update recorded." });
    expect(store.runs.get("run-1")?.summary).toBe("Provider says records are ready.");
    expect(store.events).toContainEqual(
      expect.objectContaining({
        type: "action.create_update",
        actorType: "voice_agent",
        payload: expect.objectContaining({ source: "voice_session" }),
      }),
    );
  });

  it("routes request_review with a supported review reason", async () => {
    const store = storeWithRun();

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "request_review",
      payload: {
        reason: "sensitive_legal_advice",
        summary: "The caller requested legal advice.",
      },
      store,
    });

    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision).toMatchObject({
      reason: "sensitive_legal_advice",
      summary: "The caller requested legal advice.",
    });
  });

  it("routes mark_contact_attempt with the voice session channel", async () => {
    const store = storeWithRun();

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "mark_contact_attempt",
      payload: {
        outcome: "left_message",
        summary: "Left a voicemail for the records department.",
      },
      store,
    });

    expect(store.contactAttempts).toContainEqual({
      workflowRunId: "run-1",
      channel: "voice_session",
      outcome: "left_message",
      summary: "Left a voicemail for the records department.",
    });
  });

  it("routes schedule_follow_up with a validated date", async () => {
    const store = storeWithRun();

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "schedule_follow_up",
      payload: {
        stepType: "provider_follow_up",
        dueAt: "2026-08-24T10:00:00.000Z",
        reason: "Call the provider tomorrow.",
      },
      store,
    });

    expect(store.steps.get("step-1")).toMatchObject({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      dueAt: new Date("2026-08-24T10:00:00.000Z"),
      payload: { reason: "Call the provider tomorrow." },
    });
  });

  it("routes add_review_note only when the review belongs to the active run", async () => {
    const store = storeWithRun();
    addOpenReview(store);

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "add_review_note",
      payload: {
        reviewRequestId: "review-1",
        note: "Waiting for the signed authorization.",
      },
      store,
    });

    expect(result).toEqual({ ok: true, message: "Review note added." });
    expect(store.events).toContainEqual(
      expect.objectContaining({
        workflowRunId: "run-1",
        type: "review.note_added",
        summary: "Waiting for the signed authorization.",
      }),
    );
  });

  it("rejects a review note for a different workflow run", async () => {
    const store = storeWithRun();
    store.runs.set("run-2", { ...store.runs.get("run-1")!, id: "run-2" });
    addOpenReview(store, "run-2");

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "add_review_note",
        payload: { reviewRequestId: "review-1", note: "Cross-run note." },
        store,
      }),
    ).rejects.toThrow("Review review-1 does not belong to workflow run run-1.");

    expect(store.events).toHaveLength(0);
  });

  it.each([
    ["create_update", {}, "summary is required."],
    ["request_review", { reason: "approve", summary: "Approve it." }, "reason is not a supported review reason."],
    ["mark_contact_attempt", { outcome: "unknown", summary: "Called." }, "outcome is not a supported contact outcome."],
    [
      "schedule_follow_up",
      { stepType: "provider_follow_up", dueAt: "tomorrowish", reason: "Call again." },
      "dueAt must be a valid date.",
    ],
    ["add_review_note", { reviewRequestId: "review-1", note: " " }, "note is required."],
  ])("rejects invalid %s payloads before reading the workflow run", async (toolName, payload, message) => {
    const store = storeWithRun();
    const getRun = vi.spyOn(store, "getRun");

    await expect(
      executeVoiceWorkflowTool({ workflowRunId: "run-1", toolName, payload, store }),
    ).rejects.toThrow(message);

    expect(getRun).not.toHaveBeenCalled();
  });

  it("requires complete event persistence context", async () => {
    const store = storeWithRun();
    const { store: voiceEventStore } = recordingEventStore();

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "create_update",
        payload: { summary: "Records are ready." },
        store,
        voiceEventStore,
        voiceSessionId: "voice-1",
      }),
    ).rejects.toThrow("voiceEventStore, voiceSessionId, and toolCallId must be provided together.");
  });

  it("persists tool_call and tool_result around successful execution", async () => {
    const store = storeWithRun();
    const { events, store: voiceEventStore } = recordingEventStore();

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "Records are ready." },
      store,
      voiceEventStore,
      voiceSessionId: "voice-1",
      toolCallId: "tool-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        voiceSessionId: "voice-1",
        type: "tool_call",
        toolCallId: "tool-1",
        payload: {
          toolName: "create_update",
          payload: { summary: "Records are ready." },
        },
      }),
      expect.objectContaining({
        voiceSessionId: "voice-1",
        type: "tool_result",
        toolCallId: "tool-1",
        payload: { ok: true, message: "Workflow update recorded." },
      }),
    ]);
  });

  it("persists an explicit failed tool_result when execution fails", async () => {
    const store = storeWithRun();
    const { events, store: voiceEventStore } = recordingEventStore();

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "schedule_follow_up",
        payload: {
          stepType: "not-a-real-step",
          dueAt: "2026-08-24T10:00:00.000Z",
          reason: "Call again.",
        },
        store,
        voiceEventStore,
        voiceSessionId: "voice-1",
        toolCallId: "tool-2",
      }),
    ).rejects.toThrow("Step type not-a-real-step is not defined");

    expect(events.at(-1)).toMatchObject({
      type: "tool_result",
      toolCallId: "tool-2",
      payload: {
        ok: false,
        message: "Step type not-a-real-step is not defined for workflow medical-records-follow-up.",
      },
    });
  });

  it("persists an invalid allowed tool call without reading workflow state", async () => {
    const store = storeWithRun();
    const getRun = vi.spyOn(store, "getRun");
    const { events, store: voiceEventStore } = recordingEventStore();

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "create_update",
        payload: {},
        store,
        voiceEventStore,
        voiceSessionId: "voice-1",
        toolCallId: "tool-3",
      }),
    ).rejects.toThrow("summary is required.");

    expect(getRun).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_call",
        payload: { toolName: "create_update", payload: {} },
      }),
      expect.objectContaining({
        type: "tool_result",
        payload: { ok: false, message: "summary is required." },
      }),
    ]);
  });
});
