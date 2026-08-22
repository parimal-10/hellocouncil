import { eq } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import { voiceSessionEvents, voiceSessions } from "@/db/schema";
import type { VoiceSessionPersistence } from "./session-runner";

export class DrizzleVoiceSessionStore implements VoiceSessionPersistence {
  constructor(private readonly client: DbClient = db) {}

  async createSession(input: { caseId: string; workflowRunId: string; provider: string }) {
    const [session] = await this.client
      .insert(voiceSessions)
      .values({ ...input, status: "running" })
      .returning({ id: voiceSessions.id });
    return session.id;
  }

  async appendSessionEvent(input: {
    voiceSessionId: string;
    type: string;
    speaker?: string;
    text?: string;
    toolCallId?: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }) {
    await this.client.insert(voiceSessionEvents).values({
      voiceSessionId: input.voiceSessionId,
      type: input.type,
      speaker: input.speaker,
      text: input.text,
      toolCallId: input.toolCallId,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt,
    });
  }

  async completeSession(id: string, status: "completed" | "failed") {
    await this.client
      .update(voiceSessions)
      .set({ status, endedAt: new Date() })
      .where(eq(voiceSessions.id, id));
  }
}
