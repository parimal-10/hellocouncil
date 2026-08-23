import { and, eq } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import { voiceSessionEvents, voiceSessions } from "@/db/schema";
import type { VoiceSessionPersistence } from "./session-runner";

export type LiveKitSessionRecord = {
  id: string;
  workflowRunId: string;
  caseId: string;
};

export class DrizzleVoiceSessionStore implements VoiceSessionPersistence {
  constructor(private readonly client: DbClient = db) {}

  async createSession(input: { caseId: string; workflowRunId: string; provider: string }) {
    const [session] = await this.client
      .insert(voiceSessions)
      .values({ ...input, status: "running" })
      .returning({ id: voiceSessions.id });
    return session.id;
  }

  async createLiveKitSession(input: {
    caseId: string;
    workflowRunId: string;
    roomName: string;
    participantIdentity: string;
    providerSessionId?: string;
  }) {
    const [session] = await this.client
      .insert(voiceSessions)
      .values({
        caseId: input.caseId,
        workflowRunId: input.workflowRunId,
        provider: "livekit",
        status: "pending",
        roomName: input.roomName,
        participantIdentity: input.participantIdentity,
        providerSessionId: input.providerSessionId,
      })
      .returning({ id: voiceSessions.id });
    return session.id;
  }

  async getLiveKitSessionByRoomName(roomName: string): Promise<LiveKitSessionRecord | null> {
    const [session] = await this.client
      .select({
        id: voiceSessions.id,
        workflowRunId: voiceSessions.workflowRunId,
        caseId: voiceSessions.caseId,
      })
      .from(voiceSessions)
      .where(and(eq(voiceSessions.provider, "livekit"), eq(voiceSessions.roomName, roomName)))
      .limit(1);
    return session ?? null;
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
