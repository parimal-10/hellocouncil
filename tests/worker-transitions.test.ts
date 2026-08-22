import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { TestWorkflowStore } from "./test-store";

function storeWithRun(definitionId: "client-check-in" | "medical-records-follow-up") {
  const store = new TestWorkflowStore();
  store.runs.set("run-1", {
    id: "run-1",
    definitionId,
    caseId: "case-1",
    status: "active",
    title: "Test run",
    summary: "",
  });
  store.steps.set("step-1", {
    id: "step-1",
    workflowRunId: "run-1",
    stepType: definitionId === "client-check-in" ? "client_check_in" : "provider_follow_up",
    label: "Due step",
    status: "due",
    dueAt: new Date("2026-08-23T00:00:00.000Z"),
    attemptCount: 0,
    payload: {},
  });
  return store;
}

describe("worker transitions", () => {
  it("completes an allowed due step and schedules the next step", async () => {
    const store = storeWithRun("client-check-in");
    const scheduledJobs: Array<{ stepId: string; runAt: Date }> = [];
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {
        client_check_in: "Client reports recovery is improving and has no questions.",
      },
      scheduler: {
        scheduleDueStep: async (job) => {
          scheduledJobs.push(job);
          return "job-1";
        },
      },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("completed");
    expect([...store.steps.values()].some((step) => step.id !== "step-1" && step.status === "due")).toBe(true);
    expect(store.events.map((event) => event.type)).toContain("step.completed");
    expect(scheduledJobs).toEqual([{ stepId: "step-2", runAt: new Date("2026-08-26T01:00:00.000Z") }]);
  });

  it("blocks a due step and creates a review request when policy requires human review", async () => {
    const store = storeWithRun("medical-records-follow-up");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {
        provider_follow_up: "We cannot release anything without a new authorization.",
      },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.runs.get("run-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("provider_refusal");
    expect(store.events.map((event) => event.type)).toContain("review.created");
  });

  it("blocks a provider step without authorization before creating a contact attempt", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.steps.set("step-1", { ...store.steps.get("step-1")!, payload: { hasAuthorization: false } });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("missing_authorization");
    expect(store.contactAttempts).toHaveLength(0);
  });

  it("ignores future and completed jobs without creating external effects", async () => {
    const futureStore = storeWithRun("client-check-in");
    futureStore.steps.set("step-1", {
      ...futureStore.steps.get("step-1")!,
      dueAt: new Date("2026-08-23T02:00:00.000Z"),
    });
    const completedStore = storeWithRun("client-check-in");
    completedStore.steps.set("step-1", { ...completedStore.steps.get("step-1")!, status: "completed" });
    const definitions = [clientCheckInDefinition, medicalRecordsFollowUpDefinition];

    await new WorkflowEngine({ store: futureStore, definitions }).advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));
    await new WorkflowEngine({ store: completedStore, definitions }).advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(futureStore.contactAttempts).toHaveLength(0);
    expect(completedStore.contactAttempts).toHaveLength(0);
    expect(futureStore.steps.get("step-1")?.status).toBe("due");
    expect(completedStore.steps.get("step-1")?.status).toBe("completed");
  });

  it("does not block after three reached contacts", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.steps.set("step-1", {
      ...store.steps.get("step-1")!,
      attemptCount: 2,
      payload: { failedAttemptCount: 0 },
    });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      scheduler: { scheduleDueStep: async () => "job-1" },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("completed");
    expect(store.reviews).toHaveLength(0);
    expect(store.contactAttempts[0]?.outcome).toBe("reached");
  });

  it("claims a due step once when duplicate workers advance it concurrently", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      scheduler: { scheduleDueStep: async () => "job-1" },
    });
    const now = new Date("2026-08-23T01:00:00.000Z");

    await Promise.all([engine.advanceDueStep("step-1", now), engine.advanceDueStep("step-1", now)]);

    expect(store.contactAttempts).toHaveLength(1);
    expect(store.steps.get("step-1")?.attemptCount).toBe(1);
    expect(store.steps.get("step-1")?.status).toBe("completed");
  });

  it("marks the run and created step failed when scheduler returns no job id", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      scheduler: { scheduleDueStep: async () => "" },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.runs.get("run-1")?.status).toBe("failed");
    expect(store.steps.get("step-2")?.status).toBe("failed");
    expect(store.events.map((event) => event.type)).toContain("step.schedule_failed");
  });

  it("reconciles due steps that have no queued job", async () => {
    const store = storeWithRun("client-check-in");
    const scheduledJobs: Array<{ stepId: string; runAt: Date }> = [];
    const now = new Date("2026-08-23T01:00:00.000Z");
    const { reconcileDueSteps } = await import("@/worker/reconcile-due-steps");

    await reconcileDueSteps({
      store,
      scheduler: {
        scheduleDueStep: async (job) => {
          scheduledJobs.push(job);
          return "job-1";
        },
      },
      now,
    });

    expect(scheduledJobs).toEqual([{ stepId: "step-1", runAt: now }]);
  });

  it("blocks after the third failed contact", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.steps.set("step-1", { ...store.steps.get("step-1")!, payload: { failedAttemptCount: 2 } });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: { provider_follow_up: "No response from provider." },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("failed_contact_threshold");
    expect(store.contactAttempts[0]?.outcome).toBe("failed");
  });

  it("blocks ambiguous client responses", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: { client_check_in: "Maybe, I am not sure what to do." },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.reviews[0]?.decision.reason).toBe("ambiguous_client_response");
  });

  it("blocks sensitive legal advice responses", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: { client_check_in: "Should I sign the settlement?" },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.reviews[0]?.decision.reason).toBe("sensitive_legal_advice");
  });

  it("resolves a blocked step through a controlled review action", async () => {
    const store = storeWithRun("medical-records-follow-up");
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
        summary: "Provider refused.",
      },
    });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {},
    });

    await engine.applyAction({
      type: "resolve_blocked_step",
      workflowRunId: "run-1",
      reviewRequestId: "review-1",
      resolution: "resolved",
      note: "Authorization verified.",
    });

    expect(store.reviews[0]?.status).toBe("resolved");
    expect(store.events.map((event) => event.type)).toContain("review.resolved");
  });
});
