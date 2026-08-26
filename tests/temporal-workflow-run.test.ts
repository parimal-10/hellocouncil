// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type * as activities from "@/temporal/activities/index";
import { TASK_QUEUE } from "@/temporal/config";
import { workflowRunWorkflow, workflowSignals } from "@/temporal/workflows/workflow-run";

type FakeState = {
  dueStepId: string | null;
  awaiting: boolean;
  runStatus: string;
};

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
    await handle.signal(workflowSignals.callCompleted, { callId: "call-1" });
    await handle.result();
    worker.shutdown();
    await workerPromise;

    expect(log).toEqual(["load", "execute:step-1", "load", "outcome:call-1", "load"]);
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
});
