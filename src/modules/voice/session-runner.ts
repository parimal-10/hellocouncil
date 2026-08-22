import type { WorkflowAction } from "@/modules/workflows/types";
import type { VoiceSessionAdapter, VoiceSessionEvent } from "./types";

export type VoiceSessionPersistence = {
  createSession(input: { caseId: string; workflowRunId: string; provider: string }): Promise<string>;
  appendSessionEvent(input: {
    voiceSessionId: string;
    type: string;
    speaker?: string;
    text?: string;
    toolCallId?: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void>;
  completeSession(id: string, status: "completed" | "failed"): Promise<void>;
};

export async function runVoiceSession(input: {
  adapter: VoiceSessionAdapter;
  persistence: VoiceSessionPersistence;
  caseId: string;
  workflowRunId: string;
  executeAction: (action: WorkflowAction) => Promise<{ ok: boolean; message: string }>;
}) {
  const voiceSessionId = await input.persistence.createSession({
    caseId: input.caseId,
    workflowRunId: input.workflowRunId,
    provider: "simulated",
  });
  await input.persistence.appendSessionEvent({ voiceSessionId, type: "session.started" });

  try {
    for await (const event of input.adapter.startSession({ caseId: input.caseId, workflowRunId: input.workflowRunId })) {
      await persistAdapterEvent(input.persistence, voiceSessionId, event);
      if (event.type !== "tool_call") continue;

      try {
        const result = await input.executeAction(event.action);
        await input.persistence.appendSessionEvent({
          voiceSessionId,
          type: "tool_result",
          toolCallId: event.toolCallId,
          payload: result,
          occurredAt: new Date(),
        });
      } catch (error) {
        await input.persistence.appendSessionEvent({
          voiceSessionId,
          type: "tool_result",
          toolCallId: event.toolCallId,
          payload: { ok: false, message: errorMessage(error) },
          occurredAt: new Date(),
        });
        throw error;
      }
    }

    await input.persistence.completeSession(voiceSessionId, "completed");
    await input.persistence.appendSessionEvent({ voiceSessionId, type: "session.completed" });
    return voiceSessionId;
  } catch (error) {
    await input.persistence.completeSession(voiceSessionId, "failed");
    await input.persistence.appendSessionEvent({
      voiceSessionId,
      type: "session.failed",
      payload: { error: errorMessage(error) },
    });
    throw error;
  }
}

async function persistAdapterEvent(
  persistence: VoiceSessionPersistence,
  voiceSessionId: string,
  event: VoiceSessionEvent,
) {
  if (event.type === "transcript_chunk") {
    await persistence.appendSessionEvent({
      voiceSessionId,
      type: event.type,
      speaker: event.speaker,
      text: event.text,
      occurredAt: event.occurredAt,
    });
    return;
  }

  if (event.type === "tool_call") {
    await persistence.appendSessionEvent({
      voiceSessionId,
      type: event.type,
      toolCallId: event.toolCallId,
      payload: { action: event.action },
      occurredAt: event.occurredAt,
    });
    return;
  }

  await persistence.appendSessionEvent({
    voiceSessionId,
    type: event.type,
    toolCallId: event.toolCallId,
    payload: { ok: event.ok, message: event.message },
    occurredAt: event.occurredAt,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown voice session error.";
}
