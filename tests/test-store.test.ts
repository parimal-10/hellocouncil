import { describe, expect, it } from "vitest";
import { TestWorkflowStore } from "./test-store";

describe("TestWorkflowStore", () => {
  it("returns due steps in their stored workflow state", async () => {
    const store = new TestWorkflowStore();
    const dueAt = new Date("2026-08-23T10:00:00.000Z");

    const step = await store.createStep({
      workflowRunId: "run-1",
      stepType: "client_check_in",
      label: "Check in with client",
      dueAt,
    });

    await store.updateStepStatus(step.id, "completed", 1);
    expect(await store.getDueSteps(new Date("2026-08-23T11:00:00.000Z"))).toEqual([]);

    await store.updateStepStatus(step.id, "due");
    expect(await store.getDueSteps(new Date("2026-08-23T11:00:00.000Z"))).toEqual([
      expect.objectContaining({ id: step.id, attemptCount: 1, status: "due" }),
    ]);
  });

  it("merges reviewed context into a step payload", async () => {
    const store = new TestWorkflowStore();
    const step = await store.createStep({
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      dueAt: new Date("2026-08-23T10:00:00.000Z"),
      payload: { failedAttemptCount: 1 },
    });

    await store.updateStepPayload(step.id, { hasAuthorization: true });

    expect(store.steps.get(step.id)?.payload).toEqual({ failedAttemptCount: 1, hasAuthorization: true });
  });
});
