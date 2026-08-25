"use server";

import { revalidatePath } from "next/cache";
import { createTwilioVoiceClient, loadPhoneRuntimeConfig } from "@/modules/phone/config";
import { placeOutboundCall } from "@/modules/phone/service";
import { DrizzlePhoneCallStore, loadOutboundCallContext } from "@/modules/phone/store";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

export async function placeOutboundCallAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "").trim();
  if (!workflowRunId) throw new Error("workflowRunId is required.");

  const config = loadPhoneRuntimeConfig();
  const [context, steps] = await Promise.all([
    loadOutboundCallContext(workflowRunId),
    new DrizzleWorkflowStore().listSteps(workflowRunId),
  ]);
  const step = steps.find((item) => item.status === "due" || item.status === "running");
  await placeOutboundCall({
    context,
    now: new Date(),
    store: new DrizzlePhoneCallStore(),
    twilio: createTwilioVoiceClient(config),
    config,
    workflowStepId: step?.id,
    stepType: step?.stepType,
  });

  revalidatePath("/");
  revalidatePath("/cases");
  revalidatePath("/cases/[id]", "page");
  revalidatePath("/workflows/[id]", "page");
}
