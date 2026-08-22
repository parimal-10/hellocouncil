import { describe, expect, it } from "vitest";
import { SimulatedVoiceSessionAdapter } from "@/modules/voice/simulated-adapter";
import { runVoiceSession, type VoiceSessionPersistence } from "@/modules/voice/session-runner";

class TestVoiceSessionPersistence implements VoiceSessionPersistence {
  sessions: Array<Record<string, unknown>> = [];
  events: Array<Record<string, unknown>> = [];

  async createSession(input: { caseId: string; workflowRunId: string; provider: string }) {
    this.sessions.push({ id: "voice-1", ...input, status: "running" });
    return "voice-1";
  }

  async appendSessionEvent(input: Record<string, unknown>) {
    this.events.push(input);
  }

  async completeSession(id: string, status: "completed" | "failed") {
    const session = this.sessions.find((item) => item.id === id);
    if (session) session.status = status;
  }
}

describe("voice session runner", () => {
  it("persists lifecycle, transcripts, tool calls, and tool results", async () => {
    const persistence = new TestVoiceSessionPersistence();

    await runVoiceSession({
      adapter: new SimulatedVoiceSessionAdapter(),
      persistence,
      caseId: "case-1",
      workflowRunId: "run-1",
      executeAction: async () => ({ ok: true, message: "Update recorded." }),
    });

    expect(persistence.sessions).toEqual([
      expect.objectContaining({ id: "voice-1", workflowRunId: "run-1", status: "completed" }),
    ]);
    expect(persistence.events.map((event) => event.type)).toEqual([
      "session.started",
      "transcript_chunk",
      "transcript_chunk",
      "tool_call",
      "tool_result",
      "session.completed",
    ]);
    expect(persistence.events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        toolCallId: "tool-1",
        payload: expect.objectContaining({ ok: true, message: "Update recorded." }),
      }),
    );
  });

  it("persists a failed tool result and failed lifecycle before rethrowing", async () => {
    const persistence = new TestVoiceSessionPersistence();

    await expect(
      runVoiceSession({
        adapter: new SimulatedVoiceSessionAdapter(),
        persistence,
        caseId: "case-1",
        workflowRunId: "run-1",
        executeAction: async () => { throw new Error("action rejected"); },
      }),
    ).rejects.toThrow("action rejected");

    expect(persistence.sessions[0]?.status).toBe("failed");
    expect(persistence.events.map((event) => event.type)).toContain("session.failed");
    expect(persistence.events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        payload: expect.objectContaining({ ok: false, message: "action rejected" }),
      }),
    );
  });
});
