import type { WorkflowStepScheduler } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";

export async function reconcileDueSteps(input: {
  store: WorkflowStore;
  scheduler: WorkflowStepScheduler;
  now: Date;
}): Promise<number> {
  const dueSteps = await input.store.getDueSteps(input.now);

  for (const step of dueSteps) {
    await input.scheduler.scheduleDueStep({ stepId: step.id, runAt: input.now });
  }

  return dueSteps.length;
}
