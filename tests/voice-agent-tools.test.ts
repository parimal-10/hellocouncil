import { describe, expect, it, vi } from "vitest";
import {
  executeVoiceWorkflowTool,
  voiceToolNames,
  type VoiceToolEventStore,
} from "@/voice-agent/tools";
import * as actionRouter from "@/modules/workflows/action-router";
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
  const claimed = new Set<string>();
  const results = new Map<string, Record<string, unknown>>();
  const store: VoiceToolEventStore = {
    async appendSessionEvent(input) {
      events.push(input);
      if (input.type === "tool_result" && input.toolCallId) {
        results.set(`${input.voiceSessionId}:${input.toolCallId}`, input.payload ?? {});
      }
    },
    async claimToolCall(input) {
      const key = `${input.voiceSessionId}:${input.toolCallId}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      events.push({
        voiceSessionId: input.voiceSessionId,
        type: "tool_call",
        toolCallId: input.toolCallId,
        payload: { toolName: input.toolName, payload: input.payload },
        occurredAt: input.occurredAt,
      });
      return true;
    },
    async getToolCallResult(voiceSessionId, toolCallId) {
      return results.get(`${voiceSessionId}:${toolCallId}`) ?? null;
    },
  };
  return { events, store };
}

describe("voice agent tools", () => {
  it("exposes only conservative workflow tools", () => {
    expect(voiceToolNames).toEqual([
      "get_workflow_status",
      "create_update",
      "request_review",
      "mark_contact_attempt",
      "schedule_follow_up",
      "run_follow_up_now",
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

  it("audits a disallowed tool attempt when full voice event context exists", async () => {
    const store = storeWithRun();
    const { events, store: voiceEventStore } = recordingEventStore();

    await expect(
      executeVoiceWorkflowTool({
        workflowRunId: "run-1",
        toolName: "resolve_blocked_step",
        payload: {},
        store,
        voiceEventStore,
        voiceSessionId: "voice-1",
        toolCallId: "tool-disallowed",
      }),
    ).rejects.toThrow("Tool resolve_blocked_step is not allowed for voice agents.");

    expect(events).toEqual([
      expect.objectContaining({
        type: "tool_call",
        payload: { toolName: "resolve_blocked_step", payload: {} },
      }),
      expect.objectContaining({
        type: "tool_result",
        payload: {
          ok: false,
          message: "Tool resolve_blocked_step is not allowed for voice agents.",
        },
      }),
    ]);
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
    const signals: Array<{ workflowRunId: string; signal: string; args: unknown[] }> = [];

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "schedule_follow_up",
      payload: {
        stepType: "provider_follow_up",
        dueAt: "2026-08-24T10:00:00.000Z",
        reason: "Call the provider tomorrow.",
      },
      store,
      signalRunImpl: async (options) => {
        signals.push(options);
      },
    });

    expect(store.steps.get("step-1")).toMatchObject({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      dueAt: new Date("2026-08-24T10:00:00.000Z"),
      payload: { reason: "Call the provider tomorrow." },
    });
    expect(signals).toEqual([
      {
        workflowRunId: "run-1",
        signal: "scheduleFollowUp",
        args: [
          {
            stepType: "provider_follow_up",
            dueAt: "2026-08-24T10:00:00.000Z",
            reason: "Call the provider tomorrow.",
          },
        ],
      },
    ]);
  });

  it("defaults schedule_follow_up step type and due date from the workflow definition", async () => {
    const store = storeWithRun();
    const now = new Date("2026-08-24T10:00:00.000Z");
    const signals: Array<{ workflowRunId: string; signal: string; args: unknown[] }> = [];

    await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "schedule_follow_up",
      payload: { reason: "Call the provider again." },
      store,
      signalRunImpl: async (options) => {
        signals.push(options);
      },
      now,
    });

    expect(store.steps.get("step-1")).toMatchObject({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      dueAt: new Date("2026-08-25T10:00:00.000Z"),
      payload: { reason: "Call the provider again." },
    });
    expect(signals).toEqual([
      {
        workflowRunId: "run-1",
        signal: "scheduleFollowUp",
        args: [
          {
            stepType: "provider_follow_up",
            dueAt: "2026-08-25T10:00:00.000Z",
            reason: "Call the provider again.",
          },
        ],
      },
    ]);
  });

  it("returns the spoken case briefing for get_workflow_status", async () => {
    const store = storeWithRun();

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "get_workflow_status",
      payload: {},
      store,
      loadBriefing: async () => ({
        currentStatus: "Lee v. Metro Transit is active.",
        whatHappened: [],
        nextSteps: ["Follow up with provider is due now."],
        nextFollowUp: { label: "Follow up with provider", dueAt: new Date("2026-08-24T10:00:00.000Z"), status: "due" },
        openReviews: [],
        validStepTypes: ["provider_follow_up"],
        canRunFollowUpNow: true,
        spokenSummary: "Lee v. Metro Transit has a provider follow-up due now.",
        agentContext: "Case: Lee v. Metro Transit.",
      }),
    });

    expect(result).toEqual({
      ok: true,
      message: "Lee v. Metro Transit has a provider follow-up due now.",
    });
  });

  it("requests an immediate follow-up by rescheduling the due step and signalling the workflow", async () => {
    const store = storeWithRun();
    store.steps.set("step-1", {
      id: "step-1",
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "due",
      dueAt: new Date("2026-08-24T18:00:00.000Z"),
      attemptCount: 0,
      payload: {},
    });
    const signals: Array<{ workflowRunId: string; signal: string; args: unknown[] }> = [];

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "run_follow_up_now",
      payload: {},
      store,
      signalRunImpl: async (options) => {
        signals.push(options);
      },
      now: new Date("2026-08-24T15:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      message: "Follow-up requested. The workflow will place the call shortly.",
    });
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.steps.get("step-1")?.dueAt).toEqual(new Date("2026-08-24T15:00:00.000Z"));
    expect(store.steps.get("step-1")?.payload).toMatchObject({ requestedByUser: true });
    expect(signals).toEqual([{ workflowRunId: "run-1", signal: "runFollowUpNow", args: [] }]);
  });

  it("creates an immediate due step before signalling when no step is due", async () => {
    const store = storeWithRun();
    const signals: Array<{ workflowRunId: string; signal: string; args: unknown[] }> = [];

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "run_follow_up_now",
      payload: {},
      store,
      signalRunImpl: async (options) => {
        signals.push(options);
      },
      now: new Date("2026-08-24T15:00:00.000Z"),
    });

    expect(result).toEqual({
      ok: true,
      message: "Follow-up requested. The workflow will place the call shortly.",
    });
    expect([...store.steps.values()][0]).toMatchObject({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      status: "due",
      dueAt: new Date("2026-08-24T15:00:00.000Z"),
      payload: { reason: "Immediate follow-up requested.", requestedByUser: true },
    });
    expect(signals).toEqual([{ workflowRunId: "run-1", signal: "runFollowUpNow", args: [] }]);
  });

  it("refuses to request a follow-up while the workflow is waiting for human review", async () => {
    const store = storeWithRun();
    store.runs.set("run-1", { ...store.runs.get("run-1")!, status: "waiting_for_human" });
    const signals: Array<{ workflowRunId: string; signal: string; args: unknown[] }> = [];

    const result = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "run_follow_up_now",
      payload: {},
      store,
      signalRunImpl: async (options) => {
        signals.push(options);
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "This workflow is waiting for human review. Outreach is paused until a reviewer resumes it.",
    });
    expect(signals).toEqual([]);
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
        actorType: "voice_agent",
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

  it("returns the persisted result without repeating a workflow mutation for a duplicate tool call id", async () => {
    const store = storeWithRun();
    const routeWorkflowAction = vi.spyOn(actionRouter, "routeWorkflowAction");
    const { events, store: voiceEventStore } = recordingEventStore();
    const input = {
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "Records are ready." },
      store,
      voiceEventStore,
      voiceSessionId: "voice-1",
      toolCallId: "tool-repeat",
    };

    await expect(executeVoiceWorkflowTool(input)).resolves.toEqual({
      ok: true,
      message: "Workflow update recorded.",
    });
    await expect(executeVoiceWorkflowTool(input)).resolves.toEqual({
      ok: true,
      message: "Workflow update recorded.",
    });

    expect(routeWorkflowAction).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "tool_call")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(1);
    routeWorkflowAction.mockRestore();
  });

  it("rejects an undefined follow-up step before routing to the workflow engine", async () => {
    const store = storeWithRun();
    const { events, store: voiceEventStore } = recordingEventStore();
    const routeWorkflowAction = vi.spyOn(actionRouter, "routeWorkflowAction");

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

    expect(routeWorkflowAction).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: "tool_result",
      toolCallId: "tool-2",
      payload: {
        ok: false,
        message: "Step type not-a-real-step is not defined for workflow medical-records-follow-up. Valid step types: provider_follow_up.",
      },
    });
    routeWorkflowAction.mockRestore();
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

  it("preserves the execution error when failed-result persistence also fails", async () => {
    const store = storeWithRun();
    let eventWriteCount = 0;
    const voiceEventStore: VoiceToolEventStore = {
      async claimToolCall() {
        eventWriteCount += 1;
        return true;
      },
      async getToolCallResult() {
        return null;
      },
      async appendSessionEvent() {
        eventWriteCount += 1;
        if (eventWriteCount === 2) throw new Error("voice event store unavailable");
      },
    };

    const error = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: {},
      store,
      voiceEventStore,
      voiceSessionId: "voice-1",
      toolCallId: "tool-4",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "summary is required." }),
      expect.objectContaining({ message: "voice event store unavailable" }),
    ]);
  });

  it("does not persist or return raw infrastructure errors", async () => {
    const store = storeWithRun();
    vi.spyOn(store, "getRun").mockRejectedValue(
      new Error("postgres://admin:secret@db/internal relation workflow_runs missing"),
    );
    const { events, store: voiceEventStore } = recordingEventStore();

    const error = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "Records are ready." },
      store,
      voiceEventStore,
      voiceSessionId: "voice-1",
      toolCallId: "tool-infrastructure",
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      message: "The voice workflow tool could not be completed.",
      cause: expect.objectContaining({ message: expect.stringContaining("admin:secret") }),
    });
    expect(events.at(-1)).toMatchObject({
      type: "tool_result",
      payload: { ok: false, message: "The voice workflow tool could not be completed." },
    });
    expect(JSON.stringify(events)).not.toContain("admin:secret");
  });

  it("does not reclassify a successful workflow mutation as failed when result persistence fails", async () => {
    const store = storeWithRun();
    const attemptedResults: Array<Record<string, unknown> | undefined> = [];
    const voiceEventStore: VoiceToolEventStore = {
      async claimToolCall() {
        return true;
      },
      async getToolCallResult() {
        return null;
      },
      async appendSessionEvent(input) {
        attemptedResults.push(input.payload);
        throw new Error("tool result store unavailable");
      },
    };

    const error = await executeVoiceWorkflowTool({
      workflowRunId: "run-1",
      toolName: "create_update",
      payload: { summary: "Records are ready." },
      store,
      voiceEventStore,
      voiceSessionId: "voice-1",
      toolCallId: "tool-success-result-failed",
    }).catch((caught) => caught);

    expect(store.runs.get("run-1")?.summary).toBe("Records are ready.");
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toMatchObject({
      message: "Voice workflow action completed but its result could not be persisted.",
    });
    expect((error as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "tool result store unavailable" }),
    ]);
    expect(attemptedResults).toEqual([
      { ok: true, message: "Workflow update recorded." },
    ]);
  });
});
