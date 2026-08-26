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

type WakeReason = "call_completed" | "review_resolved" | "run_now" | "scheduled" | null;

export async function workflowRunWorkflow(input: WorkflowRunInput): Promise<void> {
  const { workflowRunId } = input;

  let wake: WakeReason = null;
  const completedCallIds: string[] = [];
  let lastWake: string | null = null;

  setHandler(workflowSignals.callCompleted, (payload) => {
    completedCallIds.push(payload.callId);
    wake = "call_completed";
  });
  setHandler(workflowSignals.reviewResolved, () => {
    wake = "review_resolved";
  });
  setHandler(workflowSignals.runFollowUpNow, () => {
    wake = "run_now";
  });
  setHandler(workflowSignals.scheduleFollowUp, () => {
    wake = "scheduled";
  });
  setHandler(runStateQuery, () => ({ lastWake }));

  while (true) {
    const state = await loadRunState({ workflowRunId });

    if (state.runStatus === "completed" || state.runStatus === "failed" || state.runStatus === "cancelled") {
      return;
    }

    if (state.awaitingCallCompletion) {
      await condition(() => wake === "call_completed");
      const callId = completedCallIds.shift()!;
      wake = null;
      lastWake = `outcome:${callId}`;
      await applyCallOutcome({ callId });
      continue;
    }

    if (state.openReviewId) {
      await condition(() => wake === "review_resolved");
      wake = null;
      lastWake = "review_resolved";
      continue; // reviewer wrote projections app-side; loop reloads state
    }

    if (state.dueStepId) {
      lastWake = `execute:${state.dueStepId}`;
      const outcome = await executeDueStep({ stepId: state.dueStepId });
      if (outcome.kind === "noop") {
        // avoid a hot loop if another actor claimed the step; retry on next
        // wake or after a short delay
        await condition(() => wake !== null, 60_000);
        wake = null;
      }
      continue; // placed → awaiting; deferred → new dueAt; blocked → openReviewId
    }

    const dueInMs = state.nextDueAt === null ? null : Math.max(0, state.nextDueAt - Date.now());
    if (dueInMs === null) {
      await condition(() => wake !== null);
    } else {
      const wokeBySignal = await condition(() => wake !== null, dueInMs);
      if (!wokeBySignal) lastWake = "timer_elapsed";
    }
    wake = null; // run_now/scheduled wakes simply trigger a state reload
  }
}
