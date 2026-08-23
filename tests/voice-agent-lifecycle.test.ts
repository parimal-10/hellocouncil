// @vitest-environment node

import { describe, expect, it } from "vitest";
import { LiveKitVoiceSessionLifecycle } from "@/voice-agent/lifecycle";

function recordingStore() {
  const events: Array<Record<string, unknown>> = [];
  const transitions: Array<Record<string, unknown>> = [];
  return {
    events,
    transitions,
    store: {
      async markLiveKitSessionRunning(voiceSessionId: string) {
        transitions.push({ voiceSessionId, status: "running" });
        return true;
      },
      async finalizeLiveKitSession(
        voiceSessionId: string,
        status: "completed" | "failed",
        endedReason: string,
      ) {
        transitions.push({ voiceSessionId, status, endedReason });
        return true;
      },
      async appendSessionEvent(input: Record<string, unknown>) {
        events.push(input);
      },
    },
  };
}

describe("LiveKitVoiceSessionLifecycle", () => {
  it("transitions a pending session to running and records participant connection", async () => {
    const { events, transitions, store } = recordingStore();
    const lifecycle = new LiveKitVoiceSessionLifecycle("voice-1", store);

    await lifecycle.start(new Date("2026-08-23T10:00:00.000Z"));
    await lifecycle.participantConnected(
      "browser-run-1-launch-1",
      new Date("2026-08-23T10:00:01.000Z"),
    );

    expect(transitions).toEqual([{ voiceSessionId: "voice-1", status: "running" }]);
    expect(events).toEqual([
      {
        voiceSessionId: "voice-1",
        type: "session.started",
        occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      },
      {
        voiceSessionId: "voice-1",
        type: "participant.connected",
        speaker: "user",
        payload: { participantIdentity: "browser-run-1-launch-1" },
        occurredAt: new Date("2026-08-23T10:00:01.000Z"),
      },
    ]);
  });

  it("persists SDK transcript chunks and conversation messages", async () => {
    const { events, store } = recordingStore();
    const lifecycle = new LiveKitVoiceSessionLifecycle("voice-1", store);

    await lifecycle.userInputTranscribed({
      transcript: "The records are ready.",
      isFinal: true,
      itemId: "item-1",
      speakerId: null,
      language: "en",
      createdAt: Date.parse("2026-08-23T10:00:02.000Z"),
    });
    await lifecycle.conversationItemAdded({
      item: {
        id: "message-1",
        type: "message",
        role: "assistant",
        textContent: "I recorded that update.",
        interrupted: false,
      },
      createdAt: Date.parse("2026-08-23T10:00:03.000Z"),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "transcript_chunk",
        speaker: "user",
        text: "The records are ready.",
        payload: {
          isFinal: true,
          itemId: "item-1",
          language: "en",
        },
      }),
      expect.objectContaining({
        type: "conversation.item_added",
        speaker: "assistant",
        text: "I recorded that update.",
        payload: { itemId: "message-1", interrupted: false },
      }),
    ]);
  });

  it("finalizes a participant-disconnected session once", async () => {
    const { events, transitions, store } = recordingStore();
    const lifecycle = new LiveKitVoiceSessionLifecycle("voice-1", store);

    await lifecycle.close({
      reason: "participant_disconnected",
      error: null,
      createdAt: Date.parse("2026-08-23T10:05:00.000Z"),
    });
    await lifecycle.close({
      reason: "job_shutdown",
      error: null,
      createdAt: Date.parse("2026-08-23T10:05:01.000Z"),
    });

    expect(transitions).toEqual([
      {
        voiceSessionId: "voice-1",
        status: "completed",
        endedReason: "participant_disconnected",
      },
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "session.completed",
        payload: { reason: "participant_disconnected" },
      }),
    ]);
  });

  it("persists safe error text and finalizes failed sessions", async () => {
    const { events, transitions, store } = recordingStore();
    const lifecycle = new LiveKitVoiceSessionLifecycle("voice-1", store);

    await lifecycle.sessionError({
      error: new Error("postgres://admin:secret@db/internal relation missing"),
      createdAt: Date.parse("2026-08-23T10:04:00.000Z"),
    });
    await lifecycle.close({
      reason: "error",
      error: new Error("postgres://admin:secret@db/internal relation missing"),
      createdAt: Date.parse("2026-08-23T10:05:00.000Z"),
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "session.error",
        payload: { message: "The LiveKit voice session encountered an internal error." },
      }),
      expect.objectContaining({
        type: "session.failed",
        payload: { reason: "error" },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("admin:secret");
    expect(transitions.at(-1)).toEqual({
      voiceSessionId: "voice-1",
      status: "failed",
      endedReason: "error",
    });
  });

  it("finalizes as failed when job shutdown is the only close signal after an SDK error", async () => {
    const { transitions, store } = recordingStore();
    const lifecycle = new LiveKitVoiceSessionLifecycle("voice-1", store);

    await lifecycle.sessionError({
      error: new Error("model stream failed"),
      createdAt: Date.parse("2026-08-23T10:04:00.000Z"),
    });
    await lifecycle.complete("job_shutdown");

    expect(transitions.at(-1)).toEqual({
      voiceSessionId: "voice-1",
      status: "failed",
      endedReason: "error",
    });
  });
});
