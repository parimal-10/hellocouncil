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
    const runNowPendingBeforeLoad = runNowPending;
    const schedulePendingBeforeLoad = schedulePending;
    const pendingBeforeLoad =
      completedCallIds.length > 0 || reviewPending || runNowPending || schedulePending;
    const state = await loadRunState({ workflowRunId });

    if (state.runStatus === "completed" || state.runStatus === "failed" || state.runStatus === "cancelled") {
      return;
    }

    // Handlers only run between awaits, so a flag that appears while the load
    // above is in flight arrived after the snapshot. Its app-side effect is
    // already persisted (signals are sent after persist), but this iteration
    // captured pre-signal state; reload once so the wake is not cleared below.
    // This holds even when another signal was already pending at snapshot
    // time: each flag is checked against its own pre-load value, so an
    // arrival during the load always triggers the reload instead of being
    // silently dropped by the clears further down.
    if (
      (!pendingBeforeLoad
        && (completedCallIds.length > 0 || reviewPending || runNowPending || schedulePending))
      || (!runNowPendingBeforeLoad && runNowPending)
      || (!schedulePendingBeforeLoad && schedulePending)
    ) {
      continue;
    }

    // Consumed notifications must not keep waking the loop: runNow/schedule
    // exist only to trigger the reload at the top of the iteration. Only the
    // flags captured by the pre-load snapshot are cleared here — their
    // persisted effect is visible in this fresh state — while a flag that
    // landed mid-load was preserved above and survives to drive one more
    // reload. A review resolution without an open review is already reflected
    // in that state. Call-completion signals
    // are at-least-once (Twilio webhooks retry) and can arrive outside the
    // awaiting window entirely; each queued entry is resolved through the
    // idempotent orchestration claim ({applied:false} unless applicable) and
    // removed regardless of outcome, so a stray signal can never spin the
    // idle loop hot.
    if (!state.awaitingCallCompletion && completedCallIds.length > 0) {
      const queuedCallIds = completedCallIds.splice(0, completedCallIds.length);
      for (const callId of queuedCallIds) {
        lastWake = `outcome:${callId}`;
        await applyCallOutcome({ callId });
      }
      // The applied outcomes may have changed app-side state (scheduled steps,
      // run status); reload before deciding what to wait on.
      continue;
    }
    if (!state.openReviewId) reviewPending = false;
    if (runNowPendingBeforeLoad) runNowPending = false;
    if (schedulePendingBeforeLoad) schedulePending = false;

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
  }
}
