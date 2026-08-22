"use server";

import { revalidatePath } from "next/cache";

export async function resolveReviewAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId"));
  const reviewRequestId = String(formData.get("reviewRequestId"));
  const resolution = String(formData.get("resolution")) as "approved" | "edited" | "rejected" | "resolved";
  const note = String(formData.get("note") || "Reviewed by firm user.");
  const [definitions, { WorkflowEngine }, { DrizzleWorkflowStore }] = await Promise.all([
    import("@/modules/workflows/definitions"),
    import("@/modules/workflows/engine"),
    import("@/modules/workflows/store"),
  ]);

  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: [definitions.medicalRecordsFollowUpDefinition, definitions.clientCheckInDefinition],
  });

  await engine.applyAction({
    type: "resolve_blocked_step",
    workflowRunId,
    reviewRequestId,
    resolution,
    note,
  });

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath(`/workflows/${workflowRunId}`);
}
