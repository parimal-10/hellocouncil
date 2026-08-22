"use server";

import { revalidatePath } from "next/cache";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";

export async function runSimulatedVoiceSessionAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId"));
  const [definitions, { WorkflowEngine }, { DrizzleWorkflowStore }] = await Promise.all([
    import("@/modules/workflows/definitions"),
    import("@/modules/workflows/engine"),
    import("@/modules/workflows/store"),
  ]);

  const adapter = new SimulatedVoiceSessionAdapter();
  const store = new DrizzleWorkflowStore();
  const run = await store.getRun(workflowRunId);
  const engine = new WorkflowEngine({
    store,
    definitions: [definitions.medicalRecordsFollowUpDefinition, definitions.clientCheckInDefinition],
  });
  const definition = definitions.getWorkflowDefinition(run.definitionId);

  for await (const event of adapter.startSession({ caseId: run.caseId, workflowRunId: run.id })) {
    if (event.type === "tool_call") {
      await routeWorkflowAction({
        action: event.action,
        definition,
        engine,
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/voice");
  revalidatePath(`/workflows/${workflowRunId}`);
}
