import { and, desc, eq, isNull } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import {
  caseParticipants,
  cases,
  contactAttempts,
  humanReviewRequests,
  organizations,
  people,
  phoneCalls,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import { assembleOutboundCallContext, CALL_CONTEXT_LIMITS } from "./context";
import type { OutboundCallContext, PhoneCallRecord, PhoneCallStore, PhoneTranscriptTurn, StructuredCallOutcome } from "./types";

export class DrizzlePhoneCallStore implements PhoneCallStore {
  constructor(private readonly client: DbClient = db) {}

  async createCall(input: Omit<PhoneCallRecord, "id" | "createdAt" | "updatedAt">): Promise<PhoneCallRecord> {
    const [row] = await this.client
      .insert(phoneCalls)
      .values(serializeCall(input))
      .returning();
    return deserializeCall(row);
  }

  async getCall(id: string): Promise<PhoneCallRecord | null> {
    const [row] = await this.client.select().from(phoneCalls).where(eq(phoneCalls.id, id)).limit(1);
    return row ? deserializeCall(row) : null;
  }

  async updateCall(id: string, patch: Partial<PhoneCallRecord>): Promise<PhoneCallRecord> {
    const [row] = await this.client
      .update(phoneCalls)
      .set({ ...serializePatch(patch), updatedAt: new Date() })
      .where(eq(phoneCalls.id, id))
      .returning();
    if (!row) throw new Error(`Phone call not found: ${id}`);
    return deserializeCall(row);
  }

  async appendTranscript(id: string, turn: PhoneTranscriptTurn): Promise<PhoneCallRecord> {
    const call = await this.getCall(id);
    if (!call) throw new Error(`Phone call not found: ${id}`);
    return this.updateCall(id, { transcript: [...call.transcript, turn] });
  }

  async recordContactAttempt(input: {
    workflowRunId: string;
    workflowStepId?: string;
    channel: string;
    outcome: string;
    summary: string;
  }): Promise<string> {
    const [row] = await this.client
      .insert(contactAttempts)
      .values(input)
      .returning({ id: contactAttempts.id });
    return row.id;
  }

  async claimOrchestration(id: string, now: Date): Promise<boolean> {
    const [row] = await this.client
      .update(phoneCalls)
      .set({ orchestrationAppliedAt: now, updatedAt: now })
      .where(and(eq(phoneCalls.id, id), isNull(phoneCalls.orchestrationAppliedAt)))
      .returning({ id: phoneCalls.id });
    return Boolean(row);
  }

  async appendWorkflowEvent(input: {
    workflowRunId: string;
    type: string;
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.client.insert(workflowEvents).values({
      workflowRunId: input.workflowRunId,
      type: input.type,
      summary: input.summary,
      actorType: "voice_agent",
      payload: input.payload,
    });
  }

  async updateRunSummary(workflowRunId: string, summary: string): Promise<void> {
    await this.client
      .update(workflowRuns)
      .set({ summary, updatedAt: new Date() })
      .where(eq(workflowRuns.id, workflowRunId));
  }

  async listCallsForRun(workflowRunId: string): Promise<PhoneCallRecord[]> {
    const rows = await this.client
      .select()
      .from(phoneCalls)
      .where(eq(phoneCalls.workflowRunId, workflowRunId))
      .orderBy(desc(phoneCalls.createdAt));
    return rows.map(deserializeCall);
  }
}

export async function loadOutboundCallContext(
  workflowRunId: string,
  client: DbClient = db,
): Promise<OutboundCallContext> {
  const [run] = await client.select().from(workflowRuns).where(eq(workflowRuns.id, workflowRunId)).limit(1);
  if (!run) throw new Error(`Workflow run not found: ${workflowRunId}`);
  const [caseRecord] = await client.select().from(cases).where(eq(cases.id, run.caseId)).limit(1);
  if (!caseRecord) throw new Error(`Case not found: ${run.caseId}`);

  const [owner] = await client
    .select({ name: people.name })
    .from(people)
    .where(eq(people.id, caseRecord.assignedUserId))
    .limit(1);
  const participants = await client
    .select({
      role: caseParticipants.role,
      personName: people.name,
      personPhone: people.phone,
      personTimeZone: people.timeZone,
      personTimeZoneSource: people.timeZoneSource,
      organizationName: organizations.name,
      organizationPhone: organizations.phone,
    })
    .from(caseParticipants)
    .leftJoin(people, eq(caseParticipants.personId, people.id))
    .leftJoin(organizations, eq(caseParticipants.organizationId, organizations.id))
    .where(eq(caseParticipants.caseId, caseRecord.id));
  const clientParticipant = participants.find((participant) => participant.role === "client");
  const provider = participants.find(
    (participant) => participant.role === "medical_provider" || participant.role === "provider",
  );
  if (!clientParticipant?.personName) {
    throw new Error("This case has no client participant.");
  }

  const [events, attempts, reviews, priorCalls] = await Promise.all([
    client
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.workflowRunId, workflowRunId))
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(CALL_CONTEXT_LIMITS.events),
    client
      .select()
      .from(contactAttempts)
      .where(eq(contactAttempts.workflowRunId, workflowRunId))
      .orderBy(desc(contactAttempts.attemptedAt))
      .limit(CALL_CONTEXT_LIMITS.attempts),
    client
      .select()
      .from(humanReviewRequests)
      .where(eq(humanReviewRequests.workflowRunId, workflowRunId))
      .orderBy(desc(humanReviewRequests.createdAt))
      .limit(CALL_CONTEXT_LIMITS.reviews),
    client
      .select()
      .from(phoneCalls)
      .where(and(eq(phoneCalls.workflowRunId, workflowRunId)))
      .orderBy(desc(phoneCalls.createdAt))
      .limit(CALL_CONTEXT_LIMITS.priorCalls),
  ]);

  return assembleOutboundCallContext({
    run: {
      id: run.id,
      caseId: run.caseId,
      definitionId: run.definitionId,
      title: run.title,
      status: run.status,
      summary: run.summary,
    },
    caseRecord,
    client: {
      name: clientParticipant.personName,
      phone: clientParticipant.personPhone,
      timeZone: clientParticipant.personTimeZone,
      timeZoneSource: clientParticipant.personTimeZoneSource,
    },
    assignedUserName: owner?.name ?? "Unassigned",
    providerName: provider?.organizationName ?? provider?.personName ?? undefined,
    providerPhone: provider?.organizationPhone ?? provider?.personPhone ?? undefined,
    events,
    attempts,
    reviews,
    priorCalls: priorCalls.map(deserializeCall),
  });
}

export async function loadWorkflowStepType(stepId: string, client: DbClient = db): Promise<string | null> {
  const [step] = await client
    .select({ stepType: workflowSteps.stepType })
    .from(workflowSteps)
    .where(eq(workflowSteps.id, stepId))
    .limit(1);
  return step?.stepType ?? null;
}

function serializeCall(input: Omit<PhoneCallRecord, "id" | "createdAt" | "updatedAt">) {
  return {
    caseId: input.caseId,
    workflowRunId: input.workflowRunId,
    workflowStepId: input.workflowStepId,
    voiceSessionId: input.voiceSessionId,
    contactAttemptId: input.contactAttemptId,
    twilioCallSid: input.twilioCallSid,
    toNumber: input.toNumber,
    fromNumber: input.fromNumber,
    timeZone: input.timeZone,
    briefing: input.briefing,
    connectionStatus: input.connectionStatus,
    twilioCallStatus: input.twilioCallStatus,
    answeredBy: input.answeredBy,
    transcript: input.transcript.map(serializeTurn),
    structuredOutcome: input.structuredOutcome,
    complianceFlags: input.complianceFlags,
    completedAt: input.completedAt,
    orchestrationAppliedAt: input.orchestrationAppliedAt,
  };
}

function serializePatch(patch: Partial<PhoneCallRecord>) {
  const next: Record<string, unknown> = { ...patch };
  if (patch.transcript) next.transcript = patch.transcript.map(serializeTurn);
  delete next.id;
  delete next.createdAt;
  delete next.updatedAt;
  return next;
}

function serializeTurn(turn: PhoneTranscriptTurn) {
  return { speaker: turn.speaker, text: turn.text, occurredAt: turn.occurredAt.toISOString() };
}

function deserializeCall(row: typeof phoneCalls.$inferSelect): PhoneCallRecord {
  return {
    id: row.id,
    caseId: row.caseId,
    workflowRunId: row.workflowRunId,
    workflowStepId: row.workflowStepId,
    voiceSessionId: row.voiceSessionId,
    contactAttemptId: row.contactAttemptId,
    twilioCallSid: row.twilioCallSid,
    toNumber: row.toNumber,
    fromNumber: row.fromNumber,
    timeZone: row.timeZone,
    briefing: row.briefing,
    connectionStatus: row.connectionStatus as PhoneCallRecord["connectionStatus"],
    twilioCallStatus: row.twilioCallStatus,
    answeredBy: row.answeredBy,
    transcript: deserializeTranscript(row.transcript),
    structuredOutcome: (row.structuredOutcome as StructuredCallOutcome | null) ?? null,
    complianceFlags: Array.isArray(row.complianceFlags) ? (row.complianceFlags as PhoneCallRecord["complianceFlags"]) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    orchestrationAppliedAt: row.orchestrationAppliedAt,
  };
}

function deserializeTranscript(value: unknown): PhoneTranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    speaker: item.speaker === "client" ? "client" : "agent",
    text: String(item.text ?? ""),
    occurredAt: new Date(item.occurredAt),
  }));
}
