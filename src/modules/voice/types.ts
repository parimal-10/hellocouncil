import type { WorkflowAction } from "@/modules/workflows/types";

export type VoiceSessionEvent =
  | {
      type: "transcript_chunk";
      sessionId: string;
      speaker: "agent" | "human";
      text: string;
      occurredAt: Date;
    }
  | {
      type: "tool_call";
      sessionId: string;
      toolCallId: string;
      action: WorkflowAction;
      occurredAt: Date;
    }
  | {
      type: "tool_result";
      sessionId: string;
      toolCallId: string;
      ok: boolean;
      message: string;
      occurredAt: Date;
    };

export type VoiceSessionAdapter = {
  startSession(input: {
    caseId: string;
    workflowRunId: string;
  }): AsyncIterable<VoiceSessionEvent>;
};
