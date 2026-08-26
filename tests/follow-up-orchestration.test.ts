import { describe, expect, it } from "vitest";
import { applyOutboundCallFollowUp } from "@/modules/phone/orchestration";
import type { OutboundFollowUpPort } from "@/modules/phone/orchestration";
import type { PhoneCallRecord } from "@/modules/phone/types";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { advanceDueStep } from "@/modules/workflows/execution";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { MemoryPhoneCallStore } from "./phone-test-store";
import { TestWorkflowStore } from "./test-store";

const chicagoNoon = new Date("2026-08-24T17:00:00.000Z");
const chicagoEarly = new Date("2026-08-24T13:30:00.000Z");
const definitions = [clientCheckInDefinition, medicalRecordsFollowUpDefinition];

function storeWithClientCheckIn() {
  const store = new TestWorkflowStore();
  store.runs.set("run-1", {
    id: "run-1",
    definitionId: "client-check-in",
    caseId: "case-1",
    status: "active",
    title: "Check in",
    summary: "",
  });
  store.steps.set("step-1", {
    id: "step-1",
    workflowRunId: "run-1",
    stepType: "client_check_in",
    label: "Check in with client",
    status: "due",
    dueAt: new Date("2026-08-24T12:00:00.000Z"),
    attemptCount: 0,
    payload: {},
  });
  return store;
}

function stubDialer(overrides: Partial<OutboundFollowUpPort> = {}): OutboundFollowUpPort & { placed: string[] } {
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
    ...overrides,
  };
}

function callRecord(overrides: Partial<PhoneCallRecord> = {}): PhoneCallRecord {
  return {
    id: "call-1",
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
    createdAt: chicagoNoon,
    updatedAt: chicagoNoon,
    completedAt: chicagoNoon,
    ...overrides,
  };
}

describe("worker auto-dial", () => {
  it("defers a due client check-in outside local business hours without placing a call", async () => {
    const store = storeWithClientCheckIn();
    const dialer = stubDialer();

    await advanceDueStep({ store, outboundCaller: dialer }, "step-1", chicagoEarly);

    expect(dialer.placed).toEqual([]);
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.steps.get("step-1")?.dueAt.toISOString()).toBe("2026-08-24T14:00:00.000Z");
    expect(store.steps.get("step-1")?.attemptCount).toBe(0);
    expect(store.events.some((event) => event.type === "scheduling.decision")).toBe(true);
    expect(store.events.find((event) => event.type === "scheduling.decision")?.payload).toMatchObject({
      action: "defer_to_window",
      policyId: "follow-up-v1",
    });
  });

  it("places an outbound call for a due client check-in and leaves the step running", async () => {
    const store = storeWithClientCheckIn();
    const dialer = stubDialer();

    await advanceDueStep({ store, outboundCaller: dialer }, "step-1", chicagoNoon);

    expect(dialer.placed).toEqual(["step-1"]);
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({
      outboundCallId: "call-for-step-1",
      awaitingCallCompletion: true,
    });
    expect([...store.steps.values()].filter((step) => step.status === "due")).toHaveLength(0);
  });

  it("places an outbound call for a due provider follow-up and leaves the step running", async () => {
    const store = storeWithClientCheckIn();
    store.runs.set("run-1", { ...store.runs.get("run-1")!, definitionId: "medical-records-follow-up" });
    store.steps.set("step-1", { ...store.steps.get("step-1")!, stepType: "provider_follow_up", label: "Follow up with provider" });
    const dialer = stubDialer();

    await advanceDueStep({ store, outboundCaller: dialer }, "step-1", chicagoNoon);

    expect(dialer.placed).toEqual(["step-1"]);
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({
      outboundCallId: "call-for-step-1",
      awaitingCallCompletion: true,
    });
    expect(store.contactAttempts).toHaveLength(0);
  });
});

describe("applyOutboundCallFollowUp", () => {
  it("retries the same step after a first no-answer and logs the decision metadata", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, status: "running", attemptCount: 1 });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord());
    const engine = new WorkflowEngine({ store, definitions });

    const decision = await applyOutboundCallFollowUp({
      call: (await phoneStore.getCall("call-1"))!,
      now: chicagoNoon,
      engine,
      phoneStore,
    });

    expect(decision?.action).toBe("retry");
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.steps.get("step-1")?.dueAt.toISOString()).toBe("2026-08-24T19:00:00.000Z");
    expect(store.steps.get("step-1")?.payload).toMatchObject({ failedConnectCount: 1, awaitingCallCompletion: false });
    expect(store.events.find((event) => event.type === "scheduling.decision")?.payload).toMatchObject({
      action: "retry",
      reason: expect.stringMatching(/no connect/i),
      metadata: expect.objectContaining({ rule: "retry_same_day", failedConnectCount: 1 }),
      callId: "call-1",
      stepId: "step-1",
    });
    expect((await phoneStore.getCall("call-1"))?.orchestrationAppliedAt).toEqual(chicagoNoon);
  });

  it("schedules the client's requested callback exactly after a connected conversation", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, status: "running", attemptCount: 1 });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(
      callRecord({
        connectionStatus: "answered",
        twilioCallStatus: "completed",
        structuredOutcome: {
          newInformation: ["Call back Tuesday at 3pm."],
          requestedCallbackAt: "2026-08-25T20:00:00.000Z",
          requestedCallbackLocal: "Tuesday, August 25, 2026 at 3:00 PM CDT",
          status: "callback requested",
          sentiment: "neutral",
          shouldContinueOutreach: true,
          recommendedFollowUpHours: null,
          urgency: "normal",
        },
      }),
    );
    const engine = new WorkflowEngine({
      store,
      definitions,
    });

    await applyOutboundCallFollowUp({
      call: (await phoneStore.getCall("call-1"))!,
      now: chicagoNoon,
      engine,
      phoneStore,
    });

    expect(store.steps.get("step-1")?.status).toBe("completed");
    const next = [...store.steps.values()].find((step) => step.id !== "step-1");
    expect(next?.status).toBe("due");
    expect(next?.dueAt.toISOString()).toBe("2026-08-25T20:00:00.000Z");
    expect(store.events.find((event) => event.type === "scheduling.decision")?.payload).toMatchObject({
      action: "schedule",
      metadata: expect.objectContaining({ rule: "client_requested_time", snappedToBusinessHours: false }),
    });
  });

  it("opens human review after the third failed connect and does not schedule another call", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", {
      ...store.steps.get("step-1")!,
      status: "running",
      attemptCount: 3,
      payload: { failedConnectCount: 2 },
    });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord({ connectionStatus: "failed", twilioCallStatus: "failed" }));
    const engine = new WorkflowEngine({ store, definitions });

    await applyOutboundCallFollowUp({
      call: (await phoneStore.getCall("call-1"))!,
      now: chicagoNoon,
      engine,
      phoneStore,
    });

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("failed_contact_threshold");
    expect([...store.steps.values()].filter((step) => step.status === "due")).toHaveLength(0);
  });

  it("is idempotent if Twilio sends the terminal callback twice", async () => {
    const store = storeWithClientCheckIn();
    store.steps.set("step-1", { ...store.steps.get("step-1")!, status: "running", attemptCount: 1 });
    const phoneStore = new MemoryPhoneCallStore();
    await phoneStore.createCall(callRecord());
    const engine = new WorkflowEngine({ store, definitions });
    const input = { now: chicagoNoon, engine, phoneStore };

    await applyOutboundCallFollowUp({ call: (await phoneStore.getCall("call-1"))!, ...input });
    await applyOutboundCallFollowUp({ call: (await phoneStore.getCall("call-1"))!, ...input });

    expect(store.events.filter((event) => event.type === "scheduling.decision")).toHaveLength(1);
  });
});
