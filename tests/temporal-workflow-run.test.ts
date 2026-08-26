// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type * as activities from "@/temporal/activities/index";
import { TASK_QUEUE } from "@/temporal/config";
import { runStateQuery, workflowRunWorkflow, workflowSignals } from "@/temporal/workflows/workflow-run";

type FakeState = {
  dueStepId: string | null;
  awaiting: boolean;
  runStatus: string;
};

async function waitForWake(
  env: TestWorkflowEnvironment,
  handle: { query(query: typeof runStateQuery): Promise<{ lastWake: string | null }> },
  wake: string,
): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const state = await handle.query(runStateQuery);
    if (state.lastWake === wake) return;
    await env.sleep("10ms");
  }
  throw new Error(`wake "${wake}" was never observed`);
}

function workflowsPath(): string {
  return fileURLToPath(new URL("../src/temporal/workflows/workflow-run.ts", import.meta.url));
}

function fakeActivities(log: string[], state: FakeState) {
  const fake = {
    async loadRunState(_input: { workflowRunId: string }) {
      log.push("load");
      return {
        runStatus: state.runStatus,
        awaitingCallCompletion: state.awaiting,
        openReviewId: null,
        dueStepId: state.dueStepId,
        nextDueAt: null,
      };
    },
    async executeDueStep(input: { stepId: string }) {
      log.push(`execute:${input.stepId}`);
      state.awaiting = true;
      state.dueStepId = null;
      return { kind: "placed" };
    },
    async applyCallOutcome(input: { callId: string }) {
      log.push(`outcome:${input.callId}`);
      state.awaiting = false;
      state.runStatus = "completed";
      return { applied: true };
    },
    async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
  };
  return fake as unknown as typeof activities;
}

describe("workflowRunWorkflow", () => {
  let env: TestWorkflowEnvironment;

  beforeEach(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterEach(async () => {
    await env.teardown();
  });

  it("executes the due step, waits for the call signal, and finishes when the run completes", async () => {
    const log: string[] = [];
    const state: FakeState = { dueStepId: "step-1", awaiting: false, runStatus: "active" };
    const client = env.client.workflow;

    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-1" }],
      workflowId: "workflow-run-test-1",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fakeActivities(log, state),
    });
    const workerPromise = worker.run();
    await env.sleep("100ms"); // let the first poll happen
    await waitForWake(env, handle, "execute:step-1"); // signal only after the step ran
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log.filter((entry) => entry.startsWith("execute:"))).toEqual(["execute:step-1"]);
    expect(log.filter((entry) => entry === "outcome:call-1")).toEqual(["outcome:call-1"]);
    expect(log[log.length - 1]).toBe("load");
    expect(log[0]).toBe("load");
  }, 30000);

  it("stays alive until review resolution and resumes execution afterward", async () => {
    const log: string[] = [];
    // State machine: the first load sees an open human review and the workflow
    // must block; after the reviewResolved signal the reviewer's app-side
    // projections make step-1 due; once executed, the run reaches a terminal
    // status. The first load deterministically returns the review state so the
    // test does not depend on whether it completes before or after the signal.
    const state = { resolved: false, executed: false, loads: 0 };
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        state.loads += 1;
        if (state.loads === 1 || !state.resolved) {
          return {
            runStatus: "waiting_for_human",
            awaitingCallCompletion: false,
            openReviewId: "review-1",
            dueStepId: null,
            nextDueAt: null,
          };
        }
        if (state.executed) {
          return {
            runStatus: "completed",
            awaitingCallCompletion: false,
            openReviewId: null,
            dueStepId: null,
            nextDueAt: null,
          };
        }
        return {
          runStatus: "active",
          awaitingCallCompletion: false,
          openReviewId: null,
          dueStepId: "step-1",
          nextDueAt: null,
        };
      },
      async executeDueStep(input: { stepId: string }) {
        log.push(`execute:${input.stepId}`);
        state.executed = true;
        return { kind: "placed" };
      },
      async applyCallOutcome(input: { callId: string }) {
        log.push(`outcome:${input.callId}`);
        return { applied: true };
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-review" }],
      workflowId: "workflow-run-test-2",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the first poll block on the open review
    state.resolved = true;
    await handle.signal(workflowSignals.reviewResolved);
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log).toEqual(["load", "load", "execute:step-1", "load"]);
  }, 30000);

  it("processes a call outcome that arrives after an intervening scheduleFollowUp signal", async () => {
    const log: string[] = [];
    const state: FakeState = { dueStepId: "step-1", awaiting: false, runStatus: "active" };
    const client = env.client.workflow;

    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-interleaved" }],
      workflowId: "workflow-run-test-3",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fakeActivities(log, state),
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the workflow block awaiting callCompleted
    await waitForWake(env, handle, "execute:step-1"); // signal only after the step ran
    await handle.signal(workflowSignals.scheduleFollowUp, {
      stepType: "reminder",
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "interleaved",
    });
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log.filter((entry) => entry.startsWith("execute:"))).toEqual(["execute:step-1"]);
    expect(log.filter((entry) => entry === "outcome:call-1")).toEqual(["outcome:call-1"]);
    expect(log[log.length - 1]).toBe("load");
  }, 30000);

  it("applies outcomes for two back-to-back placed calls whose completions arrive together", async () => {
    const log: string[] = [];
    const outcomeCallIds: string[] = [];
    const appliedResults: boolean[] = [];
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        if (outcomeCallIds.length >= 2) {
          return {
            runStatus: "completed",
            awaitingCallCompletion: false,
            openReviewId: null,
            dueStepId: null,
            nextDueAt: null,
          };
        }
        return {
          runStatus: "active",
          awaitingCallCompletion: false,
          openReviewId: null,
          dueStepId: null,
          nextDueAt: null,
        };
      },
      async executeDueStep(_input: { stepId: string }) {
        throw new Error("not expected");
      },
      async applyCallOutcome(input: { callId: string }) {
        log.push(`outcome:${input.callId}`);
        outcomeCallIds.push(input.callId);
        appliedResults.push(true);
        return { applied: true };
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-multi-call" }],
      workflowId: "workflow-run-test-4",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the workflow reach its idle wait
    await handle.signal(workflowSignals.callCompleted, { callId: "call-2" });
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect([...outcomeCallIds].sort()).toEqual(["call-1", "call-2"]);
    expect(appliedResults).toEqual([true, true]); // each delivery attempted exactly once
  }, 30000);

  it("treats a duplicate callCompleted signal as an idempotent no-op instead of spinning", async () => {
    const log: string[] = [];
    const appliedResults: boolean[] = [];
    const state = { awaiting: true };
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        return {
          runStatus: "active",
          awaitingCallCompletion: state.awaiting,
          openReviewId: null,
          dueStepId: null,
          nextDueAt: null,
        };
      },
      async executeDueStep(_input: { stepId: string }) {
        throw new Error("not expected");
      },
      async applyCallOutcome(input: { callId: string }) {
        log.push(`outcome:${input.callId}`);
        const alreadyApplied = state.awaiting === false;
        appliedResults.push(!alreadyApplied);
        state.awaiting = false;
        return { applied: !alreadyApplied };
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-duplicate" }],
      workflowId: "workflow-run-test-6",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the workflow block awaiting callCompleted
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await env.sleep("100ms"); // let the first outcome be applied
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await env.sleep("500ms"); // the replayed signal must be resolved and dropped, not spun on

    const loadsAfterSettle = log.filter((entry) => entry === "load").length;
    await env.sleep("300ms");
    expect(log.filter((entry) => entry === "load").length).toBeLessThanOrEqual(loadsAfterSettle + 2);
    expect(appliedResults).toEqual([true, false]); // second delivery is a no-op claim
    await handle.cancel();
    worker.shutdown();
    await workerPromise;
  }, 30000);

  it("resolves a stray callCompleted received while idle without spinning and stays responsive", async () => {
    const log: string[] = [];
    const outcomeCallIds: string[] = [];
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        return {
          runStatus: "active",
          awaitingCallCompletion: false,
          openReviewId: null,
          dueStepId: null,
          nextDueAt: null,
        };
      },
      async executeDueStep(_input: { stepId: string }) {
        throw new Error("not expected");
      },
      async applyCallOutcome(input: { callId: string }) {
        log.push(`outcome:${input.callId}`);
        outcomeCallIds.push(input.callId);
        return { applied: false }; // nothing applicable app-side
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-stray-call" }],
      workflowId: "workflow-run-test-8",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the workflow reach its idle wait
    await handle.signal(workflowSignals.callCompleted, { callId: "stray-call" });
    await env.sleep("300ms"); // a pre-fix build spins here forever

    const loadsAfterStray = log.filter((entry) => entry === "load").length;
    expect(loadsAfterStray).toBeLessThan(10);
    await env.sleep("300ms");
    expect(log.filter((entry) => entry === "load").length).toBeLessThanOrEqual(loadsAfterStray + 2);
    expect(outcomeCallIds).toEqual(["stray-call"]); // attempted once via the idempotent claim

    await handle.signal(workflowSignals.scheduleFollowUp, {
      stepType: "client_check_in",
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "responsiveness check",
    });
    await env.sleep("200ms");
    expect(log.filter((entry) => entry === "load").length).toBeGreaterThan(loadsAfterStray);

    await handle.cancel();
    worker.shutdown();
    await workerPromise;
  }, 30000);

  it("honors a signal that lands while a state load is in flight", async () => {
    const log: string[] = [];
    let loads = 0;
    let handleRef: import("@temporalio/client").WorkflowHandle<typeof workflowRunWorkflow> | undefined;
    const executed: string[] = [];
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        loads += 1;
        if (loads === 1 && handleRef) {
          // Simulate a signal landing between the pending snapshot and the
          // completion of this in-flight load.
          await handleRef.signal(workflowSignals.runFollowUpNow, []);
        }
        if (!executed.length) {
          return {
            runStatus: "active",
            awaitingCallCompletion: false,
            openReviewId: null,
            // From the second load onward the persisted effect of the injected
            // follow-up request is visible.
            dueStepId: loads >= 2 ? "step-from-follow-up" : null,
            nextDueAt: null,
          };
        }
        return {
          runStatus: "completed",
          awaitingCallCompletion: false,
          openReviewId: null,
          dueStepId: null,
          nextDueAt: null,
        };
      },
      async executeDueStep(input: { stepId: string }) {
        log.push(`execute:${input.stepId}`);
        executed.push(input.stepId);
        return { kind: "noop" };
      },
      async applyCallOutcome(_input: { callId: string }) {
        throw new Error("not expected");
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-mid-load-signal" }],
      workflowId: "workflow-run-test-9",
      taskQueue: TASK_QUEUE,
    });
    handleRef = handle;

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();

    // The runFollowUpNow signal fired inside the first load must trigger a
    // reload that observes its persisted effect (a due step appears), which is
    // then executed; a pre-fix build clears the flag and sleeps forever.
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log[0]).toBe("load");
    expect(executed).toEqual(["step-from-follow-up"]);
  }, 30000);

  it("does not hot-loop after consuming a scheduleFollowUp signal", async () => {
    const log: string[] = [];
    const fake = {
      async loadRunState(_input: { workflowRunId: string }) {
        log.push("load");
        return {
          runStatus: "active",
          awaitingCallCompletion: false,
          openReviewId: null,
          dueStepId: null,
          nextDueAt: null,
        };
      },
      async executeDueStep(_input: { stepId: string }) {
        throw new Error("not expected");
      },
      async applyCallOutcome(_input: { callId: string }) {
        throw new Error("not expected");
      },
      async recordTemporalWorkflowId(_input: { workflowRunId: string; temporalWorkflowId: string }) {},
    } as unknown as typeof activities;

    const client = env.client.workflow;
    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-schedule-idle" }],
      workflowId: "workflow-run-test-7",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fake,
    });
    const workerPromise = worker.run();
    await env.sleep("50ms"); // let the workflow block on the idle wait
    await handle.signal(workflowSignals.scheduleFollowUp, {
      stepType: "client_check_in",
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "idle",
    });
    await env.sleep("500ms"); // the consumed signal must not keep waking the loop

    const loadsAfterSettle = log.filter((entry) => entry === "load").length;
    await env.sleep("300ms");
    expect(log.filter((entry) => entry === "load").length).toBeLessThanOrEqual(loadsAfterSettle + 2);
    expect(loadsAfterSettle).toBeLessThan(10);
    await handle.cancel();
    worker.shutdown();
    await workerPromise;
  }, 30000);

  it("returns immediately when the run is already in a terminal status", async () => {
    const log: string[] = [];
    const state: FakeState = { dueStepId: null, awaiting: false, runStatus: "cancelled" };
    const client = env.client.workflow;

    const handle = await client.start(workflowRunWorkflow, {
      args: [{ workflowRunId: "run-terminal" }],
      workflowId: "workflow-run-test-5",
      taskQueue: TASK_QUEUE,
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: workflowsPath(),
      activities: fakeActivities(log, state),
    });
    const workerPromise = worker.run();
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log).toEqual(["load"]);
  }, 30000);
});
