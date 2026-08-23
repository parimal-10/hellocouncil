// @vitest-environment node

import type { DbClient } from "@/db/client";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

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
        roomName: "workflow-run-1",
        participantIdentity: "browser-run-1",
        providerSessionId: "workflow-run-1",
      }),
    ).resolves.toBe("voice-session-1");
    expect(inserted).toEqual([
      {
        caseId: "case-1",
        workflowRunId: "run-1",
        provider: "livekit",
        status: "pending",
        roomName: "workflow-run-1",
        participantIdentity: "browser-run-1",
        providerSessionId: "workflow-run-1",
      },
    ]);
  });

  it("finds a LiveKit session by room for runtime event persistence", async () => {
    let where: SQL | undefined;
    let limit: number | undefined;
    const rows = [{ id: "voice-session-1", workflowRunId: "run-1", caseId: "case-1" }];
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
                    return rows;
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DbClient;
    const store = new DrizzleVoiceSessionStore(client);

    await expect(store.getLiveKitSessionByRoomName("workflow-run-1")).resolves.toEqual(rows[0]);
    expect(limit).toBe(1);
    expect(new PgDialect().sqlToQuery(where as SQL).params).toEqual(["livekit", "workflow-run-1"]);
  });
});
