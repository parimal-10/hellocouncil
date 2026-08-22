import { workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine, type WorkflowStepScheduler } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export type RunDueStepJob = {
  stepId: string;
};

export async function runDueStepJob(job: RunDueStepJob, scheduler?: WorkflowStepScheduler) {
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: workflowDefinitions,
    scheduler,
  });

  await engine.advanceDueStep(job.stepId, new Date());
}
