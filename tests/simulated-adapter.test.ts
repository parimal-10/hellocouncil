import { describe, expect, it } from "vitest";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";

describe("simulated voice session adapter", () => {
  it("streams transcript chunks followed by a structured workflow tool call", async () => {
    const adapter = new SimulatedVoiceSessionAdapter();
    const events = [];

    for await (const event of adapter.startSession({ caseId: "case-1", workflowRunId: "run-1" })) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "transcript_chunk",
      sessionId: "sim-run-1",
      speaker: "agent",
      text: "I can log this provider update against the workflow.",
    });
    expect(events[1]).toMatchObject({
      type: "transcript_chunk",
      sessionId: "sim-run-1",
      speaker: "human",
      text: "Northside says records will be ready Friday.",
    });
    expect(events[2]).toMatchObject({
      type: "tool_call",
      sessionId: "sim-run-1",
      toolCallId: "tool-1",
      action: {
        type: "create_update",
        workflowRunId: "run-1",
        summary: "Northside says records will be ready Friday.",
        source: "voice_session",
      },
    });
  });
});
