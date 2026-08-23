import { and, eq, inArray } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import { voiceSessionEvents, voiceSessions } from "@/db/schema";
import type { VoiceSessionPersistence } from "./session-runner";

export type LiveKitSessionRecord = {
  id: string;
  launchId: string;
  workflowRunId: string;
  caseId: string;
  roomName: string;
  participantIdentity: string;
  status: string;
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
    launchId: string;
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
        launchId: input.launchId,
        roomName: input.roomName,
        participantIdentity: input.participantIdentity,
        providerSessionId: input.providerSessionId,
      })
      .returning({ id: voiceSessions.id });
    return session.id;
  }

  async updateLiveKitSessionProviderSessionId(voiceSessionId: string, providerSessionId: string) {
    await this.client
      .update(voiceSessions)
      .set({ providerSessionId })
      .where(eq(voiceSessions.id, voiceSessionId));
  }

  async getLiveKitSessionById(voiceSessionId: string): Promise<LiveKitSessionRecord | null> {
    const [session] = await this.client
      .select({
        id: voiceSessions.id,
        launchId: voiceSessions.launchId,
        workflowRunId: voiceSessions.workflowRunId,
        caseId: voiceSessions.caseId,
        roomName: voiceSessions.roomName,
        participantIdentity: voiceSessions.participantIdentity,
        status: voiceSessions.status,
      })
      .from(voiceSessions)
      .where(and(eq(voiceSessions.provider, "livekit"), eq(voiceSessions.id, voiceSessionId)))
      .limit(1);
    if (!session?.launchId || !session.roomName || !session.participantIdentity) return null;
    return session as LiveKitSessionRecord;
  }

  async markLiveKitSessionRunning(voiceSessionId: string) {
    const [session] = await this.client
      .update(voiceSessions)
      .set({ status: "running", startedAt: new Date() })
      .where(
        and(
          eq(voiceSessions.id, voiceSessionId),
          eq(voiceSessions.provider, "livekit"),
          eq(voiceSessions.status, "pending"),
        ),
      )
      .returning({ id: voiceSessions.id });
    return Boolean(session);
  }

  async finalizeLiveKitSession(
    voiceSessionId: string,
    status: "completed" | "failed",
    endedReason: string,
  ) {
    const [session] = await this.client
      .update(voiceSessions)
      .set({ status, endedReason, endedAt: new Date() })
      .where(
        and(
          eq(voiceSessions.id, voiceSessionId),
          eq(voiceSessions.provider, "livekit"),
          inArray(voiceSessions.status, ["pending", "running"]),
        ),
      )
      .returning({ id: voiceSessions.id });
    return Boolean(session);
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

  async claimToolCall(input: {
    voiceSessionId: string;
    toolCallId: string;
    toolName: string;
    payload: unknown;
    occurredAt: Date;
  }) {
    const [event] = await this.client
      .insert(voiceSessionEvents)
      .values({
        voiceSessionId: input.voiceSessionId,
        type: "tool_call",
        toolCallId: input.toolCallId,
        payload: { toolName: input.toolName, payload: input.payload },
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing({
        target: [
          voiceSessionEvents.voiceSessionId,
          voiceSessionEvents.toolCallId,
          voiceSessionEvents.type,
        ],
      })
      .returning({ id: voiceSessionEvents.id });
    return Boolean(event);
  }

  async getToolCallResult(voiceSessionId: string, toolCallId: string) {
    const [event] = await this.client
      .select({ payload: voiceSessionEvents.payload })
      .from(voiceSessionEvents)
      .where(
        and(
          eq(voiceSessionEvents.voiceSessionId, voiceSessionId),
          eq(voiceSessionEvents.toolCallId, toolCallId),
          eq(voiceSessionEvents.type, "tool_result"),
        ),
      )
      .limit(1);
    return (event?.payload as Record<string, unknown> | undefined) ?? null;
  }

  async completeSession(id: string, status: "completed" | "failed") {
    await this.client
      .update(voiceSessions)
      .set({ status, endedAt: new Date() })
      .where(eq(voiceSessions.id, id));
  }
}
