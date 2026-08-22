import type { WorkflowStepScheduler } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";

const schedulingClaimDurationMs = 5 * 60 * 1000;

export async function reconcileDueSteps(input: {
  store: WorkflowStore;
  scheduler: WorkflowStepScheduler;
  now: Date;
}): Promise<number> {
  const dueSteps = await input.store.getDueSteps(input.now);
  let scheduledCount = 0;

  for (const step of dueSteps) {
    const claimUntil = new Date(input.now.getTime() + schedulingClaimDurationMs);
    const claimed = await input.store.claimDueStepForScheduling(step.id, input.now, claimUntil);
    if (!claimed) continue;

    try {
      const jobId = await input.scheduler.scheduleDueStep({ stepId: step.id, runAt: input.now });
      if (!jobId) throw new Error("Due-step scheduler did not return a job id.");
      await input.store.markDueStepScheduled(step.id, input.now);
      scheduledCount += 1;
    } catch (error) {
      await input.store.releaseDueStepSchedulingClaim(step.id, claimUntil);
      throw error;
    }
  }

  return scheduledCount;
}
