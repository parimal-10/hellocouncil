import { describe, expect, it } from "vitest";
import { TestWorkflowStore } from "./test-store";

describe("TestWorkflowStore", () => {
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
