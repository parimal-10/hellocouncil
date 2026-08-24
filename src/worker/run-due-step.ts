import { workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine, type OutboundFollowUpPort, type WorkflowStepScheduler } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export type RunDueStepJob = {
  stepId: string;
};

export async function runDueStepJob(
  job: RunDueStepJob,
  scheduler?: WorkflowStepScheduler,
  outboundCaller?: OutboundFollowUpPort,
) {
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: workflowDefinitions,
    scheduler,
    outboundCaller,
  });

  await engine.advanceDueStep(job.stepId, new Date());
}
