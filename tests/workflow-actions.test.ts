import { describe, expect, it } from "vitest";
import { workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { TestWorkflowStore } from "./test-store";

function storeWithRun() {
  const store = new TestWorkflowStore();
  store.runs.set("run-1", {
    id: "run-1",
    definitionId: "medical-records-follow-up",
    caseId: "case-1",
    status: "active",
    title: "Test run",
    summary: "Original summary",
  });
  return store;
}

function addBlockedReview(store: TestWorkflowStore, reason: "missing_authorization" | "provider_refusal" = "provider_refusal") {
  store.runs.set("run-1", { ...store.runs.get("run-1")!, status: "waiting_for_human" });
  store.steps.set("step-1", {
    id: "step-1",
    workflowRunId: "run-1",
    stepType: "provider_follow_up",
    label: "Follow up with provider",
    status: "waiting_for_human",
    dueAt: new Date("2026-08-23T00:00:00.000Z"),
    attemptCount: 1,
    payload: { hasAuthorization: false },
  });
  store.reviews.push({
    id: "review-1",
    status: "open",
    workflowRunId: "run-1",
    workflowStepId: "step-1",
    decision: {
      kind: "block",
      reason,
      severity: "high",
      recommendedAction: "Review the blocked workflow.",
      summary: "Workflow needs review.",
    },
  });
}

describe("structured workflow actions", () => {
  it("updates the run summary and audit trail for create_update", async () => {
    const store = storeWithRun();
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "create_update",
      workflowRunId: "run-1",
      summary: "Provider will release records Friday.",
      source: "voice_session",
    });

    expect(store.runs.get("run-1")?.summary).toBe("Provider will release records Friday.");
    expect(store.events).toContainEqual(
      expect.objectContaining({ type: "action.create_update", summary: "Provider will release records Friday." }),
    );
  });

  it("creates a human review and waits the run for request_review", async () => {
    const store = storeWithRun();
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "request_review",
      workflowRunId: "run-1",
      reason: "sensitive_legal_advice",
      summary: "Client requested legal advice.",
    });

    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]).toMatchObject({
      workflowRunId: "run-1",
      decision: { reason: "sensitive_legal_advice", summary: "Client requested legal advice." },
    });
    expect(store.events.map((event) => event.type)).toContain("review.created");
  });

  it("persists a contact attempt and audit event for mark_contact_attempt", async () => {
    const store = storeWithRun();
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "mark_contact_attempt",
      workflowRunId: "run-1",
      channel: "phone",
      outcome: "left_message",
      summary: "Left a voicemail for the provider.",
    });

    expect(store.contactAttempts).toContainEqual(
      expect.objectContaining({ channel: "phone", outcome: "left_message" }),
    );
    expect(store.events.map((event) => event.type)).toContain("action.mark_contact_attempt");
  });

  it("creates a due step and logs the schedule for schedule_follow_up", async () => {
    const store = storeWithRun();
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });
    const dueAt = new Date("2026-08-24T10:00:00.000Z");

    await engine.applyAction({
      type: "schedule_follow_up",
      workflowRunId: "run-1",
      dueAt,
      stepType: "provider_follow_up",
      reason: "Provider requested a call tomorrow.",
    });

    expect(store.steps.get("step-1")).toMatchObject({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      status: "due",
      payload: { reason: "Provider requested a call tomorrow." },
    });
    expect(store.events).toContainEqual(
      expect.objectContaining({
        type: "step.scheduled",
        summary: "Provider requested a call tomorrow.",
        actorType: "voice_agent",
        payload: { stepId: "step-1", stepType: "provider_follow_up", dueAt: dueAt.toISOString() },
      }),
    );
  });

  it("runs a scheduled follow-up immediately by placing the outbound call", async () => {
    const store = storeWithRun();
    store.steps.set("step-1", {
      id: "step-1",
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "due",
      dueAt: new Date("2026-08-25T10:00:00.000Z"),
      attemptCount: 0,
      payload: {},
    });
    const placedCalls: Array<{ workflowRunId: string; stepId: string }> = [];
    const engine = new WorkflowEngine({
      store,
      definitions: workflowDefinitions,
      outboundCaller: {
        evaluateWindow: async () => ({ timeZone: "America/New_York" }),
        placeCall: async (input) => {
          placedCalls.push(input);
          return { callId: "call-now-1" };
        },
      },
    });

    const result = await engine.runFollowUpNow("run-1", new Date("2026-08-24T12:00:00.000Z"));

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Follow-up call placed");
    expect(placedCalls).toEqual([
      { workflowRunId: "run-1", stepId: "step-1", now: new Date("2026-08-24T12:00:00.000Z") },
    ]);
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({
      outboundCallId: "call-now-1",
      awaitingCallCompletion: true,
      requestedByUser: true,
    });
  });

  it("refuses to run outreach while the workflow is waiting for human review", async () => {
    const store = storeWithRun();
    addBlockedReview(store);
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await expect(engine.runFollowUpNow("run-1", new Date("2026-08-24T12:00:00.000Z"))).resolves.toEqual({
      ok: false,
      message: "This workflow is waiting for human review. Outreach is paused until a reviewer resumes it.",
    });
    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
  });
});

describe("review actions", () => {
  it("assigns an owner without resuming the blocked step", async () => {
    const store = storeWithRun();
    addBlockedReview(store);
    store.people.set("firm-user-1", { id: "firm-user-1", role: "firm_user" });
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId: "review-1",
      resolution: "assigned",
      assignedUserId: "firm-user-1",
      note: "Assigned to Maya.",
    });

    expect(store.reviews[0]?.status).toBe("assigned");
    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
  });

  it("approves missing authorization by updating payload before resuming", async () => {
    const store = storeWithRun();
    addBlockedReview(store, "missing_authorization");
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId: "review-1",
      resolution: "approved",
      note: "Signed authorization verified.",
    });

    expect(store.reviews[0]?.status).toBe("approved");
    expect(store.steps.get("step-1")).toMatchObject({
      status: "due",
      payload: expect.objectContaining({ hasAuthorization: true }),
    });
    expect(store.runs.get("run-1")?.status).toBe("active");
  });

  it("persists edited human context before resuming", async () => {
    const store = storeWithRun();
    addBlockedReview(store);
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId: "review-1",
      resolution: "edited",
      note: "Call the provider records desk, not billing.",
    });

    expect(store.steps.get("step-1")).toMatchObject({
      status: "due",
      payload: expect.objectContaining({ humanReviewNote: "Call the provider records desk, not billing." }),
    });
    expect(store.events).toContainEqual(
      expect.objectContaining({ type: "review.edited", summary: "Call the provider records desk, not billing." }),
    );
  });

  it("rejects the automation without rescheduling it", async () => {
    const store = storeWithRun();
    addBlockedReview(store);
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId: "review-1",
      resolution: "rejected",
      note: "Do not contact this provider again.",
    });

    expect(store.reviews[0]?.status).toBe("rejected");
    expect(store.steps.get("step-1")?.status).toBe("skipped");
    expect(store.runs.get("run-1")?.status).toBe("failed");
  });

  it("adds an auditable note without changing review or workflow status", async () => {
    const store = storeWithRun();
    addBlockedReview(store);
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });

    await engine.applyAction({
      type: "add_review_note",
      reviewRequestId: "review-1",
      note: "Waiting for the signed form from the client.",
      source: "reviewer",
    });

    expect(store.reviews[0]?.status).toBe("open");
    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.events).toContainEqual(
      expect.objectContaining({
        workflowRunId: "run-1",
        type: "review.note_added",
        summary: "Waiting for the signed form from the client.",
        actorType: "reviewer",
      }),
    );
  });
});
