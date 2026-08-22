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
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {
        client_check_in: "Client reports recovery is improving and has no questions.",
      },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("completed");
    expect([...store.steps.values()].some((step) => step.id !== "step-1" && step.status === "due")).toBe(true);
    expect(store.events.map((event) => event.type)).toContain("step.completed");
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
