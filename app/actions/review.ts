"use server";

import { revalidatePath } from "next/cache";

export async function resolveReviewAction(formData: FormData) {
  const reviewRequestId = requiredFormValue(formData, "reviewRequestId");
  const resolution = reviewResolution(formData.get("resolution"));
  const note = String(formData.get("note") || "Reviewed by firm user.");
  const assignedUserId = optionalFormValue(formData, "assignedUserId");
  const [definitions, { WorkflowEngine }, { DrizzleWorkflowStore }] = await Promise.all([
    import("@/modules/workflows/definitions"),
    import("@/modules/workflows/engine"),
    import("@/modules/workflows/store"),
  ]);

  const engine = new WorkflowEngine({
    store: new DrizzleWorkflowStore(),
    definitions: definitions.workflowDefinitions,
  });

  if (resolution === "note") {
    await engine.applyAction({ type: "add_review_note", reviewRequestId, note, source: "reviewer" });
  } else {
    const reviewBefore = await new DrizzleWorkflowStore().getReview(reviewRequestId);
    await engine.applyAction({
      type: "resolve_blocked_step",
      reviewRequestId,
      resolution,
      note,
      assignedUserId,
    });
    const { signalRun } = await import("@/temporal/start-run");
    await signalRun({
      workflowRunId: reviewBefore.workflowRunId,
      signal: "reviewResolved",
      args: [],
    });
  }

  revalidatePath("/");
  revalidatePath("/review");
  revalidatePath("/workflows/[id]", "page");
}

function requiredFormValue(formData: FormData, name: string) {
  const value = optionalFormValue(formData, name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalFormValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reviewResolution(value: FormDataEntryValue | null) {
  if (value === "approved" || value === "edited" || value === "rejected" || value === "resolved" || value === "assigned" || value === "note") {
    return value;
  }
  throw new Error("Invalid review resolution.");
}
