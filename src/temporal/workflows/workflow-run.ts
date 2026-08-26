import { condition, defineQuery, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities";

export type WorkflowRunInput = { workflowRunId: string };

export const workflowSignals = {
  callCompleted: defineSignal<[payload: { callId: string }]>("callCompleted"),
  reviewResolved: defineSignal<[]>("reviewResolved"),
  runFollowUpNow: defineSignal<[]>("runFollowUpNow"),
  scheduleFollowUp: defineSignal<[payload: { stepType: string; dueAt: string; reason: string }]>("scheduleFollowUp"),
};

export const runStateQuery = defineQuery<{ lastWake: string | null }>("runState");

const { loadRunState, executeDueStep, applyCallOutcome } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
  },
});

export async function workflowRunWorkflow(input: WorkflowRunInput): Promise<void> {
  const { workflowRunId } = input;

  const completedCallIds: string[] = [];
  let reviewPending = false;
  let runNowPending = false;
  let schedulePending = false;
  let lastWake: string | null = null;

  // Each handler only records its own pending state; nothing is shared or
  // cross-cleared, so a signal delivered while the workflow waits on another
  // branch can never be lost.
  setHandler(workflowSignals.callCompleted, (payload) => {
    completedCallIds.push(payload.callId);
  });
  setHandler(workflowSignals.reviewResolved, () => {
    reviewPending = true;
  });
  setHandler(workflowSignals.runFollowUpNow, () => {
    runNowPending = true;
  });
  setHandler(workflowSignals.scheduleFollowUp, () => {
    schedulePending = true;
  });
  setHandler(runStateQuery, () => ({ lastWake }));

  const anyPendingSignal = () =>
    completedCallIds.length > 0 || reviewPending || runNowPending || schedulePending;

  while (true) {
    const state = await loadRunState({ workflowRunId });

    if (state.runStatus === "completed" || state.runStatus === "failed" || state.runStatus === "cancelled") {
      return;
    }

    if (state.awaitingCallCompletion) {
      await condition(() => completedCallIds.length > 0);
      const callId = completedCallIds.shift();
      if (callId !== undefined) {
        lastWake = `outcome:${callId}`;
        await applyCallOutcome({ callId });
      }
      continue;
    }

    if (state.openReviewId) {
      await condition(() => reviewPending);
      reviewPending = false;
      lastWake = "review_resolved";
      continue; // reviewer wrote projections app-side; loop reloads state
    }

    if (state.dueStepId) {
      lastWake = `execute:${state.dueStepId}`;
      const outcome = await executeDueStep({ stepId: state.dueStepId });
      if (outcome.kind === "noop") {
        // avoid a hot loop if another actor claimed the step; retry on next
        // wake or after a short delay
        await condition(anyPendingSignal, 60_000);
      }
      continue; // placed → awaiting; deferred → new dueAt; blocked → openReviewId
    }

    const dueInMs = state.nextDueAt === null ? null : Math.max(0, state.nextDueAt - Date.now());
    if (dueInMs === null) {
      await condition(anyPendingSignal);
    } else {
      const wokeBySignal = await condition(anyPendingSignal, dueInMs);
      if (!wokeBySignal) lastWake = "timer_elapsed";
    }
    // Flags are intentionally not reset here: runNow/schedule simply trigger a
    // state reload (their effects were already persisted app-side before the
    // signal), and reviewPending/calls are consumed at their own branches.
  }
}
