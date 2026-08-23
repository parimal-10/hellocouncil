"use server";

export async function createLiveKitVoiceSessionAction(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  if (!workflowRunId) throw new Error("workflowRunId is required.");

  const [
    { getLiveKitConfig },
    { createBrowserVoiceSessionLaunch },
    { createValidatedLiveKitVoiceSession },
    { DrizzleWorkflowStore },
    { DrizzleVoiceSessionStore },
  ] =
    await Promise.all([
      import("@/modules/livekit/config"),
      import("@/modules/livekit/token"),
      import("@/modules/livekit/orchestration"),
      import("@/modules/workflows/store"),
      import("@/modules/voice/store"),
    ]);

  const workflowStore = new DrizzleWorkflowStore();
  return createValidatedLiveKitVoiceSession({
    workflowRunId,
    workflowStore,
    launch: (run) =>
      createBrowserVoiceSessionLaunch({
        config: getLiveKitConfig(),
        store: new DrizzleVoiceSessionStore(),
        workflowRunId: run.workflowRunId,
        caseId: run.caseId,
      }),
  });
}
