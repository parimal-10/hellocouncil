import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowStore } from "@/modules/workflows/store";
import type { WorkflowDefinitionId } from "@/modules/workflows/types";

export async function createValidatedLiveKitVoiceSession<T>(input: {
  workflowRunId: string;
  workflowStore: Pick<WorkflowStore, "getRun">;
  launch(input: { workflowRunId: string; caseId: string }): Promise<T>;
  getDefinition?: typeof getWorkflowDefinition;
}): Promise<T> {
  const run = await input.workflowStore.getRun(input.workflowRunId);
  (input.getDefinition ?? getWorkflowDefinition)(run.definitionId as WorkflowDefinitionId);
  return input.launch({ workflowRunId: run.id, caseId: run.caseId });
}
