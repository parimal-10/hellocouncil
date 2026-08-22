import type { VoiceSessionAdapter, VoiceSessionEvent } from "./types";

export class SimulatedVoiceSessionAdapter implements VoiceSessionAdapter {
  async *startSession(input: { caseId: string; workflowRunId: string }): AsyncIterable<VoiceSessionEvent> {
    const sessionId = `sim-${input.workflowRunId}`;
    const now = new Date();

    yield {
      type: "transcript_chunk",
      sessionId,
      speaker: "agent",
      text: "I can log this provider update against the workflow.",
      occurredAt: now,
    };

    yield {
      type: "transcript_chunk",
      sessionId,
      speaker: "human",
      text: "Northside says records will be ready Friday.",
      occurredAt: new Date(now.getTime() + 500),
    };

    yield {
      type: "tool_call",
      sessionId,
      toolCallId: "tool-1",
      action: {
        type: "create_update",
        workflowRunId: input.workflowRunId,
        summary: "Northside says records will be ready Friday.",
        source: "voice_session",
      },
      occurredAt: new Date(now.getTime() + 1000),
    };
  }
}
