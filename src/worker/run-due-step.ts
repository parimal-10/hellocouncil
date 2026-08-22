import { clientCheckInDefinition, medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export type RunDueStepJob = {
  stepId: string;
};

export async function runDueStepJob(job: RunDueStepJob) {
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [medicalRecordsFollowUpDefinition, clientCheckInDefinition],
  });

  await engine.advanceDueStep(job.stepId, new Date());
}
