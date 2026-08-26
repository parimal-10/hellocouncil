import { describe, expect, it, vi } from "vitest";
import { makeApplyCallOutcome, makeExecuteDueStep, makeLoadRunState } from "@/temporal/activities/runtime";
import { makeExecuteDueStepActivity, openReviewsForRunQuery } from "@/temporal/activities/index";
import { db } from "@/db/client";
import { WorkflowEngine } from "@/modules/workflows/engine";
import type { OutboundFollowUpPort } from "@/modules/phone/orchestration";
import type { PhoneCallRecord } from "@/modules/phone/types";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { MemoryPhoneCallStore } from "./phone-test-store";
import { TestWorkflowStore } from "./test-store";

const definitions = [clientCheckInDefinition, medicalRecordsFollowUpDefinition];
const now = new Date("2026-08-26T15:00:00.000Z");

function listOpenReviews(store: TestWorkflowStore) {
  return async (workflowRunId: string) =>
    store.reviews
      .filter(
        (review) =>
          review.workflowRunId === workflowRunId && (review.status === "open" || review.status === "assigned"),
      )
      .map((review) => ({ id: review.id }));
}

function storeWithClientCheckIn() {
  const store = new TestWorkflowStore();
  store.runs.set("run-1", {
    id: "run-1",
    definitionId: "client-check-in",
    caseId: "case-1",
    status: "active",
    title: "T",
    summary: "",
  });
  store.steps.set("step-1", {
    id: "step-1",
    workflowRunId: "run-1",
    stepType: "client_check_in",
    label: "Check in",
    status: "due",
    dueAt: now,
    attemptCount: 0,
    payload: {},
  });
  return store;
}

function stubDialer(): OutboundFollowUpPort & { placed: string[] } {
  const placed: string[] = [];
  return {
    placed,
    async evaluateWindow() {
      return { timeZone: "America/Chicago" };
    },
    async placeCall(input) {
      placed.push(input.stepId);
      return { callId: `call-for-${input.stepId}` };
    },
  };
}

function callRecord(overrides: Partial<PhoneCallRecord> = {}): Omit<PhoneCallRecord, "id" | "createdAt" | "updatedAt"> {
  return {
    caseId: "case-1",
    workflowRunId: "run-1",
    workflowStepId: "step-1",
    voiceSessionId: null,
    contactAttemptId: "attempt-1",
    twilioCallSid: "CA1",
    toNumber: "+13125550101",
    fromNumber: "+15551234567",
    timeZone: "America/Chicago",
    briefing: "briefing",
    connectionStatus: "no-answer",
    twilioCallStatus: "no-answer",
    answeredBy: null,
    transcript: [],
    structuredOutcome: null,
    complianceFlags: [],
    orchestrationAppliedAt: null,
    completedAt: now,
    ...overrides,
  };
}

describe("loadRunState", () => {
  it("reports the earliest due step and awaiting-call state", async () => {
    const store = storeWithClientCheckIn();
    const load = makeLoadRunState({ workflowStore: store, listOpenReviews: listOpenReviews(store) });

    const snapshot = await load({ workflowRunId: "run-1", now });

    expect(snapshot).toEqual({
      runStatus: "active",
      awaitingCallCompletion: false,
      openReviewId: null,
      dueStepId: "step-1",
      nextDueAt: null,
    });
  });

  it("reports an awaiting-call snapshot while a placed call is in flight", async () => {
    const store = new TestWorkflowStore();
    store.runs.set("run-1", {
      id: "run-1",
      definitionId: "client-check-in",
      caseId: "case-1",
      status: "active",
      title: "T",
      summary: "",
    });
    store.steps.set("step-1", {
      id: "step-1",
      workflowRunId: "run-1",
      stepType: "client_check_in",
      label: "Check in",
      status: "running",
      dueAt: new Date(0),
      attemptCount: 1,
      payload: { outboundCallId: "call-1", awaitingCallCompletion: true },
    });
    const load = makeLoadRunState({ workflowStore: store, listOpenReviews: listOpenReviews(store) });

    const snapshot = await load({ workflowRunId: "run-1", now });

    expect(snapshot).toEqual({
      runStatus: "active",
      awaitingCallCompletion: true,
      openReviewId: null,
      dueStepId: null,
      nextDueAt: null,
    });
  });

  it("surfaces an open review and future due step", async () => {
    const store = new TestWorkflowStore();
    store.runs.set("run-1", {
      id: "run-1",
      definitionId: "client-check-in",
      caseId: "case-1",
      status: "waiting_for_human",
      title: "T",
      summary: "",
    });
    store.steps.set("step-1", {
      id: "step-1",
      workflowRunId: "run-1",
      stepType: "client_check_in",
      label: "Check in",
      status: "waiting_for_human",
      dueAt: new Date(0),
      attemptCount: 1,
      payload: {},
    });
    store.steps.set("step-2", {
      id: "step-2",
      workflowRunId: "run-1",
      stepType: "client_check_in",
      label: "Next",
      status: "due",
      dueAt: new Date("2027-01-01T00:00:00.000Z"),
      attemptCount: 0,
      payload: {},
    });
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
        summary: "Refused.",
      },
    });
    const load = makeLoadRunState({ workflowStore: store, listOpenReviews: listOpenReviews(store) });

    const snapshot = await load({ workflowRunId: "run-1", now });

    expect(snapshot.openReviewId).toBe("review-1");
    expect(snapshot.runStatus).toBe("waiting_for_human");
    expect(snapshot.nextDueAt).toBe(new Date("2027-01-01T00:00:00.000Z").getTime());
    expect(snapshot.dueStepId).toBeNull();
  });
});

describe("makeApplyCallOutcome", () => {
  it("applies the follow-up decision for a terminal call exactly once", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, status: "running", attemptCount: 1 });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord());
    const apply = makeApplyCallOutcome({
      engineFactory: () => new WorkflowEngine({ store, definitions }),
      phoneStore,
    });

    const first = await apply({ callId: "call-1" });

    expect(first.applied).toBe(true);
    expect((await phoneStore.getCall("call-1"))?.orchestrationAppliedAt).not.toBeNull();
  });

  it("is idempotent when the call was already claimed", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, status: "running", attemptCount: 1 });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord());
    const apply = makeApplyCallOutcome({
      engineFactory: () => new WorkflowEngine({ store, definitions }),
      phoneStore,
    });

    const first = await apply({ callId: "call-1" });
    const second = await apply({ callId: "call-1" });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(store.events.filter((event) => event.type === "scheduling.decision")).toHaveLength(1);
  });

  it("does not claim or apply anything for a non-terminal call", async () => {
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord({ connectionStatus: "ringing", twilioCallStatus: "ringing", completedAt: null }));
    let enginesBuilt = 0;
    const apply = makeApplyCallOutcome({
      engineFactory: () => {
        enginesBuilt += 1;
        return new WorkflowEngine({ store: new TestWorkflowStore(), definitions });
      },
      phoneStore,
    });

    const result = await apply({ callId: "call-1" });

    expect(result).toEqual({ applied: false });
    expect((await phoneStore.getCall("call-1"))?.orchestrationAppliedAt).toBeNull();
    expect(enginesBuilt).toBe(0);
  });
});

describe("makeExecuteDueStep", () => {
  it("places a call for a due step through advanceDueStep", async () => {
    const store = storeWithClientCheckIn();
    const dialer = stubDialer();
    const execute = makeExecuteDueStep({ store, outboundCaller: dialer });

    const outcome = await execute({ stepId: "step-1", now });

    expect(outcome).toEqual({ kind: "placed" });
    expect(dialer.placed).toEqual(["step-1"]);
    expect(store.steps.get("step-1")?.status).toBe("running");
  });

  it("returns noop when the step is not yet due", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, dueAt: new Date(now.getTime() + 60_000) });
    const dialer = stubDialer();
    const execute = makeExecuteDueStep({ store, outboundCaller: dialer });

    const outcome = await execute({ stepId: "step-1", now });

    expect(outcome).toEqual({ kind: "noop" });
  });
});

describe("executeDueStep AUTO_OUTBOUND_CALLS gating", () => {
  it("does not construct the dialer and refuses-and-recovers when the flag is off", async () => {
    const store = storeWithClientCheckIn();
    // The activity uses the real clock, so make the step unconditionally due.
    store.steps.set("step-1", { ...store.steps.get("step-1")!, dueAt: new Date(0) });
    const dialerFactory = vi.fn(() => stubDialer());
    const execute = makeExecuteDueStepActivity({
      storeFactory: () => store,
      outboundCallerFactory: dialerFactory,
      isAutoOutboundEnabled: () => false,
    });

    await expect(execute({ stepId: "step-1" })).rejects.toThrow(/AUTO_OUTBOUND_CALLS/);

    expect(dialerFactory).not.toHaveBeenCalled();
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.events.some((event) => event.type === "step.processing_failed")).toBe(true);
  });

  it("constructs the dialer and places the call when the flag is on", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, dueAt: new Date(0) });
    const dialer = stubDialer();
    const dialerFactory = vi.fn(() => dialer);
    const execute = makeExecuteDueStepActivity({
      storeFactory: () => store,
      outboundCallerFactory: dialerFactory,
      isAutoOutboundEnabled: () => true,
    });

    const outcome = await execute({ stepId: "step-1" });

    // The real clock may fall outside business hours, in which case
    // advanceDueStep legitimately defers instead of placing.
    expect(["placed", "deferred_to_window"]).toContain(outcome.kind);
    expect(dialerFactory).toHaveBeenCalledTimes(1);
  });
});

describe("openReviewsForRunQuery", () => {
  it("treats assigned reviews as pending human work alongside open ones", () => {
    const { sql, params } = openReviewsForRunQuery(db, "run-1").toSQL();

    expect(params).toContain("run-1");
    expect(params).toContain("open");
    expect(params).toContain("assigned");
    expect(sql).toContain("human_review_requests");
  });
});

describe("loadRunState with an assigned review", () => {
  it("surfaces an assigned review as openReviewId and defers execution", async () => {
    const store = storeWithClientCheckIn();
    store.reviews.push({
      id: "review-1",
      status: "assigned",
      workflowRunId: "run-1",
      workflowStepId: "step-1",
      decision: {
        kind: "block",
        reason: "failed_contact_threshold",
        severity: "medium",
        recommendedAction: "Review contact strategy.",
        summary: "Too many failed connects.",
      },
    });
    const load = makeLoadRunState({ workflowStore: store, listOpenReviews: listOpenReviews(store) });

    const snapshot = await load({ workflowRunId: "run-1", now });

    expect(snapshot.openReviewId).toBe("review-1");
    expect(snapshot.dueStepId).toBeNull();
  });
});
