"use server";

import { revalidatePath } from "next/cache";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";
import { runVoiceSession } from "@/modules/voice/session-runner";

export async function runSimulatedVoiceSessionAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId"));
  const [definitions, { WorkflowEngine }, { DrizzleWorkflowStore }, { DrizzleVoiceSessionStore }] = await Promise.all([
    import("@/modules/workflows/definitions"),
    import("@/modules/workflows/engine"),
    import("@/modules/workflows/store"),
    import("@/modules/voice/store"),
  ]);

  const adapter = new SimulatedVoiceSessionAdapter();
  const store = new DrizzleWorkflowStore();
  const run = await store.getRun(workflowRunId);
  const engine = new WorkflowEngine({
    store,
    definitions: definitions.workflowDefinitions,
  });
  const definition = definitions.getWorkflowDefinition(run.definitionId);

  await runVoiceSession({
    adapter,
    persistence: new DrizzleVoiceSessionStore(),
    caseId: run.caseId,
    workflowRunId: run.id,
    executeAction: (action) =>
      routeWorkflowAction({
        action,
        definition,
        engine,
      }),
  });

  revalidatePath("/");
  revalidatePath("/voice");
  revalidatePath(`/workflows/${workflowRunId}`);
}
