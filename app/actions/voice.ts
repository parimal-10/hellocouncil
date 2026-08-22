"use server";

import { revalidatePath } from "next/cache";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";

export async function runSimulatedVoiceSessionAction(formData: FormData) {
  const caseId = String(formData.get("caseId"));
  const workflowRunId = String(formData.get("workflowRunId"));
  const definitionId = String(formData.get("definitionId")) as "medical-records-follow-up" | "client-check-in";
  const [definitions, { WorkflowEngine }, { DrizzleWorkflowStore }] = await Promise.all([
    import("@/modules/workflows/definitions"),
    import("@/modules/workflows/engine"),
    import("@/modules/workflows/store"),
  ]);

  const adapter = new SimulatedVoiceSessionAdapter();
  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [definitions.medicalRecordsFollowUpDefinition, definitions.clientCheckInDefinition],
  });
  const definition = definitions.getWorkflowDefinition(definitionId);

  for await (const event of adapter.startSession({ caseId, workflowRunId })) {
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
