import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import type { WorkflowAction } from "@/modules/workflows/types";
import { configureWorkflowQueues, jobNames, PgBossWorkflowStepScheduler } from "@/worker/boss";
import { reconcileDueSteps } from "@/worker/reconcile-due-steps";
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

  it("leaves the run active and created step due when scheduler returns no job id", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      scheduler: { scheduleDueStep: async () => "" },
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(store.runs.get("run-1")?.status).toBe("active");
    expect(store.steps.get("step-2")?.status).toBe("due");
    expect(store.events.map((event) => event.type)).toContain("step.schedule_failed");
  });

  it("does not reject an existing standard due-step queue", async () => {
    const calls: unknown[][] = [];
    const boss = {
      createQueue: async (...args: unknown[]) => {
        calls.push(args);
      },
      getQueue: async () => ({ policy: "standard" }),
    };

    await expect(configureWorkflowQueues(boss as never)).resolves.toBeUndefined();
    expect(calls).toEqual([[jobNames.runDueStep, { policy: "key_strict_fifo" }]]);
  });

  it("uses the workflow step id as the deterministic pg-boss job id", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const boss = {
      send: async (...args: unknown[]) => {
        calls.push({ method: "send", args });
        return calls.length === 1 ? "step-1" : null;
      },
    };
    const scheduler = new PgBossWorkflowStepScheduler(boss as never);
    const runAt = new Date("2026-08-23T01:00:00.000Z");

    await expect(scheduler.scheduleDueStep({ stepId: "step-1", runAt })).resolves.toBe("step-1");
    await expect(scheduler.scheduleDueStep({ stepId: "step-1", runAt })).resolves.toBe("step-1");

    expect(calls).toEqual([
      {
        method: "send",
        args: [
          jobNames.runDueStep,
          { stepId: "step-1" },
          { id: "step-1", singletonKey: "workflow.run-due-step:step-1", startAfter: runAt },
        ],
      },
      {
        method: "send",
        args: [
          jobNames.runDueStep,
          { stepId: "step-1" },
          { id: "step-1", singletonKey: "workflow.run-due-step:step-1", startAfter: runAt },
        ],
      },
    ]);
  });

  it("claims a due step once across concurrent reconciliation", async () => {
    const store = storeWithRun("client-check-in");
    const scheduledJobs: Array<{ stepId: string; runAt: Date }> = [];
    const now = new Date("2026-08-23T01:00:00.000Z");
    const input = {
      store,
      scheduler: {
        scheduleDueStep: async (job: { stepId: string; runAt: Date }) => {
          scheduledJobs.push(job);
          return "job-1";
        },
      },
      now,
    };

    await Promise.all([reconcileDueSteps(input), reconcileDueSteps(input)]);
    await reconcileDueSteps({ ...input, now: new Date("2026-08-23T01:06:00.000Z") });

    expect(scheduledJobs).toEqual([{ stepId: "step-1", runAt: now }]);
  });

  it("releases a failed scheduling claim so reconciliation can retry", async () => {
    const store = storeWithRun("client-check-in");
    const now = new Date("2026-08-23T01:00:00.000Z");
    let callCount = 0;
    let rejectFirstCall!: (error: Error) => void;
    let markFirstCallStarted!: () => void;
    const firstCallStarted = new Promise<void>((resolve) => {
      markFirstCallStarted = resolve;
    });
    const firstCallFailure = new Promise<never>((_resolve, reject) => {
      rejectFirstCall = reject;
    });
    const input = {
      store,
      scheduler: {
        scheduleDueStep: async () => {
          callCount += 1;
          if (callCount === 1) {
            markFirstCallStarted();
            return firstCallFailure;
          }
          return "job-1";
        },
      },
      now,
    };

    const firstReconciliation = reconcileDueSteps(input);
    await firstCallStarted;
    const concurrentResult = await reconcileDueSteps(input);
    rejectFirstCall(new Error("queue unavailable"));
    await expect(firstReconciliation).rejects.toThrow("queue unavailable");
    const retryResult = await reconcileDueSteps(input);

    expect(concurrentResult).toBe(0);
    expect(retryResult).toBe(1);
    expect(callCount).toBe(2);
  });

  it("retries reconciliation after a crashed scheduler claim expires", async () => {
    const store = storeWithRun("client-check-in");
    store.steps.set("step-1", {
      ...store.steps.get("step-1")!,
      queueSchedulingClaimUntil: new Date("2026-08-23T01:05:00.000Z"),
    });
    const scheduledJobs: Array<{ stepId: string; runAt: Date }> = [];
    const scheduler = {
      scheduleDueStep: async (job: { stepId: string; runAt: Date }) => {
        scheduledJobs.push(job);
        return "job-1";
      },
    };

    expect(
      await reconcileDueSteps({
        store,
        scheduler,
        now: new Date("2026-08-23T01:00:00.000Z"),
      }),
    ).toBe(0);
    expect(
      await reconcileDueSteps({
        store,
        scheduler,
        now: new Date("2026-08-23T01:06:00.000Z"),
      }),
    ).toBe(1);
    expect(scheduledJobs).toEqual([
      { stepId: "step-1", runAt: new Date("2026-08-23T01:06:00.000Z") },
    ]);
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
    store.runs.set("run-2", {
      id: "run-2",
      definitionId: "client-check-in",
      caseId: "case-2",
      status: "waiting_for_human",
      title: "Unrelated run",
      summary: "",
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
        summary: "Provider refused.",
      },
    });
    const engine = new WorkflowEngine({
      store,
      definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition],
      syntheticResponses: {},
    });

    const tamperedAction = {
      type: "resolve_blocked_step",
      workflowRunId: "run-2",
      reviewRequestId: "review-1",
      resolution: "resolved",
      note: "Authorization verified.",
    } as unknown as WorkflowAction;

    await engine.applyAction(tamperedAction);

    expect(store.reviews[0]?.status).toBe("resolved");
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.runs.get("run-1")?.status).toBe("active");
    expect(store.runs.get("run-2")?.status).toBe("waiting_for_human");
    expect(store.events).toContainEqual(expect.objectContaining({ workflowRunId: "run-1", type: "review.resolved" }));
  });

  it("rejects actions for reviews that are no longer reviewable", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.reviews.push({
      id: "review-1",
      status: "resolved",
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
    });

    await expect(
      engine.applyAction({
        type: "resolve_blocked_step",
        reviewRequestId: "review-1",
        resolution: "resolved",
        note: "Authorization verified.",
      }),
    ).rejects.toThrow("not open or assigned");

    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.runs.get("run-1")?.status).toBe("active");
  });
});
