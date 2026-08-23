"use server";

export async function createLiveKitVoiceSessionAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  if (!workflowRunId) throw new Error("workflowRunId is required.");

  const [{ getLiveKitConfig }, { createBrowserVoiceSessionLaunch }, { DrizzleWorkflowStore }, { DrizzleVoiceSessionStore }] =
    await Promise.all([
      import("@/modules/livekit/config"),
      import("@/modules/livekit/token"),
      import("@/modules/workflows/store"),
      import("@/modules/voice/store"),
    ]);

  const workflowStore = new DrizzleWorkflowStore();
  const run = await workflowStore.getRun(workflowRunId);

  return createBrowserVoiceSessionLaunch({
    config: getLiveKitConfig(),
    store: new DrizzleVoiceSessionStore(),
    workflowRunId: run.id,
    caseId: run.caseId,
  });
}
