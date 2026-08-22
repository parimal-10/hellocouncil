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

  it("records voice actions as workflow events", async () => {
    const store = new TestWorkflowStore();

    await expect(
      store.applyAction({
        type: "create_update",
        workflowRunId: "run-1",
        summary: "Client confirmed the appointment.",
        source: "voice_session",
      }),
    ).resolves.toEqual({ ok: true, message: "Applied create_update" });

    expect(store.events).toEqual([
      expect.objectContaining({ type: "action.create_update", actorType: "voice_agent" }),
    ]);
  });
});
