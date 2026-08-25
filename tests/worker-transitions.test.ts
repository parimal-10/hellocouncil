import { describe, expect, it } from "vitest";
import { WorkflowEngine, type OutboundFollowUpPort } from "@/modules/workflows/engine";
import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import type { WorkflowAction } from "@/modules/workflows/types";
import { configureWorkflowQueues, jobNames, PgBossWorkflowStepScheduler } from "@/worker/boss";
import { reconcileDueSteps } from "@/worker/reconcile-due-steps";
import { TestWorkflowStore } from "./test-store";

const definitions = [clientCheckInDefinition, medicalRecordsFollowUpDefinition];

function fakeCaller(timeZone = "America/Chicago") {
  const placedCalls: Array<{ workflowRunId: string; stepId: string; now: Date }> = [];
  const caller: OutboundFollowUpPort = {
    evaluateWindow: async () => ({ timeZone }),
    placeCall: async (input) => {
      placedCalls.push(input);
      return { callId: `call-${placedCalls.length}` };
    },
  };
  return { caller, placedCalls };
}

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
  it("places an automatic outbound call for a due step and awaits call completion", async () => {
    const store = storeWithRun("client-check-in");
    const { caller, placedCalls } = fakeCaller();
    const engine = new WorkflowEngine({
      store,
      definitions,
      outboundCaller: caller,
    });

    await engine.advanceDueStep("step-1", new Date("2026-08-24T15:00:00.000Z"));

    expect(placedCalls).toEqual([
      { workflowRunId: "run-1", stepId: "step-1", now: new Date("2026-08-24T15:00:00.000Z") },
    ]);
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({
      outboundCallId: "call-1",
      awaitingCallCompletion: true,
    });
    expect(store.events.map((event) => event.type)).toContain("step.running");
  });

  it("blocks a provider step without authorization before placing a call", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.steps.set("step-1", { ...store.steps.get("step-1")!, payload: { hasAuthorization: false } });
    const { caller, placedCalls } = fakeCaller();
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: caller });

    await engine.advanceDueStep("step-1", new Date("2026-08-24T15:00:00.000Z"));

    expect(store.steps.get("step-1")?.status).toBe("waiting_for_human");
    expect(store.reviews[0]?.decision.reason).toBe("missing_authorization");
    expect(store.contactAttempts).toHaveLength(0);
    expect(placedCalls).toHaveLength(0);
  });

  it("ignores future and completed jobs without creating external effects", async () => {
    const futureStore = storeWithRun("client-check-in");
    futureStore.steps.set("step-1", {
      ...futureStore.steps.get("step-1")!,
      dueAt: new Date("2026-08-23T02:00:00.000Z"),
    });
    const completedStore = storeWithRun("client-check-in");
    completedStore.steps.set("step-1", { ...completedStore.steps.get("step-1")!, status: "completed" });
    const { caller } = fakeCaller();

    await new WorkflowEngine({ store: futureStore, definitions, outboundCaller: caller }).advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));
    await new WorkflowEngine({ store: completedStore, definitions, outboundCaller: caller }).advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z"));

    expect(futureStore.contactAttempts).toHaveLength(0);
    expect(completedStore.contactAttempts).toHaveLength(0);
    expect(futureStore.steps.get("step-1")?.status).toBe("due");
    expect(completedStore.steps.get("step-1")?.status).toBe("completed");
  });

  it("claims a due step once when duplicate workers advance it concurrently", async () => {
    const store = storeWithRun("client-check-in");
    const { caller, placedCalls } = fakeCaller();
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: caller });
    const now = new Date("2026-08-24T15:00:00.000Z");

    await Promise.all([engine.advanceDueStep("step-1", now), engine.advanceDueStep("step-1", now)]);

    expect(placedCalls).toHaveLength(1);
    expect(store.steps.get("step-1")?.attemptCount).toBe(1);
    expect(store.steps.get("step-1")?.status).toBe("running");
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

  it("uses fresh pg-boss job ids when the same reviewed step is rescheduled", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const boss = {
      send: async (...args: unknown[]) => {
        calls.push({ method: "send", args });
        return `job-${calls.length}`;
      },
    };
    const scheduler = new PgBossWorkflowStepScheduler(boss as never);
    const runAt = new Date("2026-08-23T01:00:00.000Z");

    await expect(scheduler.scheduleDueStep({ stepId: "step-1", runAt })).resolves.toBe("job-1");
    await expect(scheduler.scheduleDueStep({ stepId: "step-1", runAt })).resolves.toBe("job-2");

    expect(calls).toEqual([
      {
        method: "send",
        args: [
          jobNames.runDueStep,
          { stepId: "step-1" },
          { singletonKey: "workflow.run-due-step:step-1", startAfter: runAt },
        ],
      },
      {
        method: "send",
        args: [
          jobNames.runDueStep,
          { stepId: "step-1" },
          { singletonKey: "workflow.run-due-step:step-1", startAfter: runAt },
        ],
      },
    ]);
  });

  it("rejects a pg-boss send that does not create a runnable job", async () => {
    const scheduler = new PgBossWorkflowStepScheduler({ send: async () => null } as never);

    await expect(
      scheduler.scheduleDueStep({ stepId: "step-1", runAt: new Date("2026-08-23T01:00:00.000Z") }),
    ).rejects.toThrow("did not return a job id");
  });

  it("enqueues the same workflow step again after human review reschedules it", async () => {
    const store = storeWithRun("medical-records-follow-up");
    const calls: unknown[][] = [];
    const scheduler = new PgBossWorkflowStepScheduler({
      send: async (...args: unknown[]) => {
        calls.push(args);
        return `job-${calls.length}`;
      },
    } as never);
    await scheduler.scheduleDueStep({ stepId: "step-1", runAt: new Date("2026-08-23T00:00:00.000Z") });
    store.steps.set("step-1", {
      ...store.steps.get("step-1")!,
      status: "waiting_for_human",
      queueJobScheduledAt: new Date("2026-08-23T00:00:00.000Z"),
    });
    store.runs.set("run-1", { ...store.runs.get("run-1")!, status: "waiting_for_human" });
    store.reviews.push({
      id: "review-1",
      status: "open",
      workflowRunId: "run-1",
      workflowStepId: "step-1",
      decision: {
        kind: "block",
        reason: "missing_authorization",
        severity: "high",
        recommendedAction: "Verify authorization.",
        summary: "Authorization missing.",
      },
    });
    const engine = new WorkflowEngine({ store, definitions: [clientCheckInDefinition, medicalRecordsFollowUpDefinition] });

    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId: "review-1",
      resolution: "approved",
      note: "Authorization verified.",
    });
    const scheduledCount = await reconcileDueSteps({ store, scheduler, now: new Date("2100-01-01T00:00:00.000Z") });

    expect(scheduledCount).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      jobNames.runDueStep,
      { stepId: "step-1" },
      {
        singletonKey: "workflow.run-due-step:step-1",
        startAfter: new Date("2100-01-01T00:00:00.000Z"),
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
    const engine = new WorkflowEngine({ store, definitions });

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

  it("rejects a non-firm user as a review owner without changing the review", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.people.set("client-1", { id: "client-1", role: "client" });
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
    });

    await expect(
      engine.applyAction({
        type: "resolve_blocked_step",
        reviewRequestId: "review-1",
        resolution: "assigned",
        assignedUserId: "client-1",
        note: "Assigning for follow-up.",
      }),
    ).rejects.toThrow("must be a firm user");

    expect(store.reviews[0]?.status).toBe("open");
    expect(store.events.map((event) => event.type)).not.toContain("review.assigned");
  });

  it("defers an autonomous due step outside local business hours without placing a call", async () => {
    const store = storeWithRun("client-check-in");
    const { caller, placedCalls } = fakeCaller("America/Chicago");
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: caller });
    // 2026-08-23T01:00:00Z is Saturday 20:00 in America/Chicago.
    const now = new Date("2026-08-23T01:00:00.000Z");

    await engine.advanceDueStep("step-1", now);

    expect(placedCalls).toHaveLength(0);
    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.steps.get("step-1")?.dueAt).toEqual(new Date("2026-08-24T14:00:00.000Z"));
    expect(store.events.map((event) => event.type)).toContain("scheduling.decision");
  });

  it("places the call immediately for an explicitly requested follow-up outside business hours", async () => {
    const store = storeWithRun("client-check-in");
    store.steps.set("step-1", {
      ...store.steps.get("step-1")!,
      payload: { requestedByUser: true },
    });
    const { caller, placedCalls } = fakeCaller("America/Chicago");
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: caller });
    // 2026-08-23T01:00:00Z is Saturday 20:00 in America/Chicago.
    const now = new Date("2026-08-23T01:00:00.000Z");

    await engine.advanceDueStep("step-1", now);

    expect(placedCalls).toHaveLength(1);
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({ awaitingCallCompletion: true });
  });

  it("returns a claimed step to due when placing the call throws so it can be retried", async () => {
    const store = storeWithRun("medical-records-follow-up");
    let failNextCall = true;
    let callCount = 0;
    const caller: OutboundFollowUpPort = {
      evaluateWindow: async () => ({ timeZone: "America/Chicago" }),
      placeCall: async () => {
        callCount += 1;
        if (failNextCall) {
          failNextCall = false;
          throw new Error("twilio unavailable");
        }
        return { callId: `call-${callCount}` };
      },
    };
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: caller });
    const now = new Date("2026-08-24T15:00:00.000Z");

    await expect(engine.advanceDueStep("step-1", now)).rejects.toThrow("twilio unavailable");

    expect(store.steps.get("step-1")?.status).toBe("due");
    expect(store.events).toContainEqual(
      expect.objectContaining({ workflowRunId: "run-1", type: "step.processing_failed" }),
    );

    await expect(engine.advanceDueStep("step-1", now)).resolves.toBeUndefined();
    expect(store.steps.get("step-1")?.status).toBe("running");
    expect(store.steps.get("step-1")?.payload).toMatchObject({ awaitingCallCompletion: true });
  });

  it("fails a claimed step after its processing retry limit is exhausted", async () => {
    const store = storeWithRun("medical-records-follow-up");
    store.steps.set("step-1", { ...store.steps.get("step-1")!, attemptCount: 3 });
    const failingCaller: OutboundFollowUpPort = {
      evaluateWindow: async () => ({ timeZone: "America/Chicago" }),
      placeCall: async () => {
        throw new Error("twilio unavailable");
      },
    };
    const engine = new WorkflowEngine({ store, definitions, outboundCaller: failingCaller });

    await expect(
      engine.advanceDueStep("step-1", new Date("2026-08-24T15:00:00.000Z")),
    ).rejects.toThrow("twilio unavailable");

    expect(store.steps.get("step-1")?.status).toBe("failed");
    expect(store.runs.get("run-1")?.status).toBe("failed");
    expect(store.events).toContainEqual(
      expect.objectContaining({
        type: "step.processing_failed",
        payload: expect.objectContaining({ retryLimit: 3, retryable: false }),
      }),
    );
  });

  it("fails a claimed step when automatic outbound calling is not configured", async () => {
    const store = storeWithRun("client-check-in");
    const engine = new WorkflowEngine({ store, definitions });

    await expect(
      engine.advanceDueStep("step-1", new Date("2026-08-23T01:00:00.000Z")),
    ).rejects.toThrow("Automatic outbound calling is not configured");

    expect(store.events).toContainEqual(
      expect.objectContaining({ workflowRunId: "run-1", type: "step.processing_failed" }),
    );
  });
});
