"use server";

import { revalidatePath } from "next/cache";
import { createTwilioVoiceClient, loadPhoneRuntimeConfig } from "@/modules/phone/config";
import { placeOutboundCall } from "@/modules/phone/service";
import { DrizzlePhoneCallStore, loadOutboundCallContext } from "@/modules/phone/store";

export async function placeOutboundCallAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "").trim();
  if (!workflowRunId) throw new Error("workflowRunId is required.");

  const config = loadPhoneRuntimeConfig();
  const context = await loadOutboundCallContext(workflowRunId);
  await placeOutboundCall({
    context,
    now: new Date(),
    store: new DrizzlePhoneCallStore(),
    twilio: createTwilioVoiceClient(config),
    config,
  });

  revalidatePath("/");
  revalidatePath("/workflows/[id]", "page");
}
