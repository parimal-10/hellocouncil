// @vitest-environment node

import type { DbClient } from "@/db/client";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { voiceSessionEvents, voiceSessions } from "@/db/schema";

vi.mock("@/db/client", () => ({ db: {} }));

import { DrizzleVoiceSessionStore } from "@/modules/voice/store";

describe("DrizzleVoiceSessionStore LiveKit sessions", () => {
  it("creates a pending LiveKit session with room metadata", async () => {
    const inserted: unknown[] = [];
    const client = {
      insert() {
        return {
          values(value: unknown) {
            inserted.push(value);
            return {
              async returning() {
                return [{ id: "voice-session-1" }];
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(
      store.createLiveKitSession({
        caseId: "case-1",
        workflowRunId: "run-1",
        launchId: "launch-1",
        roomName: "workflow-run-1-launch-1",
        participantIdentity: "browser-run-1-launch-1",
        providerSessionId: "dispatch-1",
      }),
    ).resolves.toBe("voice-session-1");
    expect(inserted).toEqual([
      {
        caseId: "case-1",
        workflowRunId: "run-1",
        provider: "livekit",
        status: "pending",
        launchId: "launch-1",
        roomName: "workflow-run-1-launch-1",
        participantIdentity: "browser-run-1-launch-1",
        providerSessionId: "dispatch-1",
      },
    ]);
  });

  it("updates the provider session id after LiveKit dispatch", async () => {
    let values: unknown;
    let where: SQL | undefined;
    const client = {
      update() {
        return {
          set(value: unknown) {
            values = value;
            return {
              async where(condition: SQL) {
                where = condition;
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await store.updateLiveKitSessionProviderSessionId("voice-session-1", "dispatch-1");

    expect(values).toEqual({ providerSessionId: "dispatch-1" });
    expect(new PgDialect().sqlToQuery(where as SQL).params).toEqual(["voice-session-1"]);
  });

  it("finds an exact LiveKit session by its persisted id", async () => {
    let where: SQL | undefined;
    let limit: number | undefined;
    const row = {
      id: "voice-session-1",
      launchId: "launch-1",
      workflowRunId: "run-1",
      caseId: "case-1",
      roomName: "workflow-run-1-launch-1",
      participantIdentity: "browser-run-1-launch-1",
      status: "pending",
    };
    const client = {
      select() {
        return {
          from() {
            return {
              where(condition: SQL) {
                where = condition;
                return {
                  async limit(value: number) {
                    limit = value;
                    return [row];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(store.getLiveKitSessionById("voice-session-1")).resolves.toEqual(row);
    expect(limit).toBe(1);
    expect(new PgDialect().sqlToQuery(where as SQL).params).toEqual([
      "livekit",
      "voice-session-1",
    ]);
  });

  it("transitions a pending LiveKit session to running at worker start", async () => {
    let values: unknown;
    const client = {
      update() {
        return {
          set(value: unknown) {
            values = value;
            return {
              where() {
                return {
                  async returning() {
                    return [{ id: "voice-session-1" }];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(store.markLiveKitSessionRunning("voice-session-1")).resolves.toBe(true);
    expect(values).toMatchObject({ status: "running", startedAt: expect.any(Date) });
  });

  it("finalizes a LiveKit session with an ended reason", async () => {
    let values: unknown;
    const client = {
      update() {
        return {
          set(value: unknown) {
            values = value;
            return {
              where() {
                return {
                  async returning() {
                    return [{ id: "voice-session-1" }];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(
      store.finalizeLiveKitSession("voice-session-1", "failed", "worker_error"),
    ).resolves.toBe(true);
    expect(values).toMatchObject({
      status: "failed",
      endedReason: "worker_error",
      endedAt: expect.any(Date),
    });
  });

  it("claims a tool call by inserting its audit event once", async () => {
    const inserted: unknown[] = [];
    let conflictTarget: unknown;
    const client = {
      insert() {
        return {
          values(value: unknown) {
            inserted.push(value);
            return {
              onConflictDoNothing(options: unknown) {
                conflictTarget = options;
                return {
                  async returning() {
                    return [{ id: "event-1" }];
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(
      store.claimToolCall({
        voiceSessionId: "voice-session-1",
        toolCallId: "tool-1",
        toolName: "create_update",
        payload: { summary: "Ready." },
        occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      }),
    ).resolves.toBe(true);
    expect(inserted).toEqual([
      {
        voiceSessionId: "voice-session-1",
        type: "tool_call",
        toolCallId: "tool-1",
        payload: { toolName: "create_update", payload: { summary: "Ready." } },
        occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      },
    ]);
    expect(conflictTarget).toEqual({
      target: [
        voiceSessionEvents.voiceSessionId,
        voiceSessionEvents.toolCallId,
        voiceSessionEvents.type,
      ],
    });
  });

  it("defines unique launch, room, participant, and tool-call audit indexes", () => {
    expect(getTableConfig(voiceSessions).indexes.map((item) => item.config.name)).toEqual(
      expect.arrayContaining([
        "voice_sessions_launch_id_unique",
        "voice_sessions_room_name_unique",
        "voice_sessions_participant_identity_unique",
      ]),
    );
    expect(getTableConfig(voiceSessionEvents).indexes.map((item) => item.config.name)).toContain(
      "voice_session_events_tool_call_unique",
    );
  });
});
