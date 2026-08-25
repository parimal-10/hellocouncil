import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
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
} from "@/db/schema";
import type { CaseUpdate, OrganizationUpdate, PersonUpdate } from "./update";

export async function updateCaseRecord(caseId: string, update: CaseUpdate) {
  const [owner] = await db
    .select({ id: people.id, role: people.role })
    .from(people)
    .where(and(eq(people.id, update.assignedUserId), eq(people.role, "firm_user")))
    .limit(1);
  if (!owner) throw new Error("Assigned user must be a firm user.");

  const [updated] = await db
    .update(cases)
    .set({
      matterName: update.matterName,
      status: update.status,
      assignedUserId: update.assignedUserId,
    })
    .where(eq(cases.id, caseId))
    .returning({ id: cases.id });
  if (!updated) throw new Error("Case not found.");
}

export async function updatePersonRecord(personId: string, update: PersonUpdate) {
  const [updated] = await db
    .update(people)
    .set({
      name: update.name,
      phone: update.phone,
      email: update.email,
      timeZone: update.timeZone,
      timeZoneSource: update.timeZoneSource,
    })
    .where(eq(people.id, personId))
    .returning({ id: people.id });
  if (!updated) throw new Error("Person not found.");
}

export async function updateOrganizationRecord(organizationId: string, update: OrganizationUpdate) {
  const [updated] = await db
    .update(organizations)
    .set({
      name: update.name,
      type: update.type,
      phone: update.phone,
    })
    .where(eq(organizations.id, organizationId))
    .returning({ id: organizations.id });
  if (!updated) throw new Error("Organization not found.");
}

export async function listCaseDirectory() {
  const [caseRows, participantRows, runRows] = await Promise.all([
    db.select().from(cases).orderBy(desc(cases.createdAt)),
    db
      .select({
        caseId: caseParticipants.caseId,
        role: caseParticipants.role,
        personId: people.id,
        personName: people.name,
        personPhone: people.phone,
        personEmail: people.email,
        personTimeZone: people.timeZone,
        personTimeZoneSource: people.timeZoneSource,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationPhone: organizations.phone,
      })
      .from(caseParticipants)
      .leftJoin(people, eq(caseParticipants.personId, people.id))
      .leftJoin(organizations, eq(caseParticipants.organizationId, organizations.id)),
    db
      .select({
        id: workflowRuns.id,
        caseId: workflowRuns.caseId,
        title: workflowRuns.title,
        status: workflowRuns.status,
      })
      .from(workflowRuns)
      .orderBy(desc(workflowRuns.updatedAt)),
  ]);
  const owners = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.role, "firm_user"));
  const ownersById = new Map(owners.map((owner) => [owner.id, owner.name]));

  return caseRows.map((caseRecord) => {
    const participants = participantRows.filter((row) => row.caseId === caseRecord.id);
    const client = participants.find((row) => row.role === "client" && row.personId);
    const provider = participants.find(
      (row) => (row.role === "medical_provider" || row.role === "provider") && (row.organizationId || row.personId),
    );
    return {
      id: caseRecord.id,
      matterName: caseRecord.matterName,
      status: caseRecord.status,
      createdAt: caseRecord.createdAt.toISOString(),
      assignedUserId: caseRecord.assignedUserId,
      assignedUserName: ownersById.get(caseRecord.assignedUserId) ?? "Unassigned",
      client: client?.personId
        ? {
            id: client.personId,
            name: client.personName ?? "Unknown client",
            phone: client.personPhone,
            email: client.personEmail,
            timeZone: client.personTimeZone,
            timeZoneSource: client.personTimeZoneSource,
          }
        : null,
      provider: provider
        ? {
            name: provider.organizationName ?? provider.personName ?? "Unknown provider",
            phone: provider.organizationPhone ?? provider.personPhone ?? null,
          }
        : null,
      workflowCount: runRows.filter((run) => run.caseId === caseRecord.id).length,
    };
  });
}

export async function getCaseFile(caseId: string) {
  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, caseId)).limit(1);
  if (!caseRecord) return null;

  const [participantRows, runRows, firmUsers] = await Promise.all([
    db
      .select({
        id: caseParticipants.id,
        role: caseParticipants.role,
        personId: people.id,
        personName: people.name,
        personRole: people.role,
        personPhone: people.phone,
        personEmail: people.email,
        personTimeZone: people.timeZone,
        personTimeZoneSource: people.timeZoneSource,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationType: organizations.type,
        organizationPhone: organizations.phone,
      })
      .from(caseParticipants)
      .leftJoin(people, eq(caseParticipants.personId, people.id))
      .leftJoin(organizations, eq(caseParticipants.organizationId, organizations.id))
      .where(eq(caseParticipants.caseId, caseId)),
    db
      .select({
        id: workflowRuns.id,
        title: workflowRuns.title,
        status: workflowRuns.status,
        summary: workflowRuns.summary,
        updatedAt: workflowRuns.updatedAt,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.caseId, caseId))
      .orderBy(desc(workflowRuns.updatedAt)),
    db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(eq(people.role, "firm_user"))
      .orderBy(asc(people.name)),
  ]);
  const runIds = runRows.map((run) => run.id);
  const [attemptRows, reviewRows, eventRows, callRows] =
    runIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(contactAttempts)
            .where(inArray(contactAttempts.workflowRunId, runIds))
            .orderBy(desc(contactAttempts.attemptedAt)),
          db
            .select()
            .from(humanReviewRequests)
            .where(inArray(humanReviewRequests.workflowRunId, runIds))
            .orderBy(desc(humanReviewRequests.createdAt)),
          db
            .select()
            .from(workflowEvents)
            .where(inArray(workflowEvents.workflowRunId, runIds))
            .orderBy(desc(workflowEvents.occurredAt)),
          db
            .select()
            .from(phoneCalls)
            .where(inArray(phoneCalls.workflowRunId, runIds))
            .orderBy(desc(phoneCalls.createdAt)),
        ])
      : [[], [], [], []];

  const peopleOnCase = participantRows
    .filter((row) => row.personId)
    .map((row) => ({
      participantId: row.id,
      participantRole: row.role,
      id: row.personId!,
      name: row.personName ?? "",
      role: row.personRole ?? "",
      phone: row.personPhone,
      email: row.personEmail,
      timeZone: row.personTimeZone,
      timeZoneSource: row.personTimeZoneSource,
    }));
  const organizationsOnCase = participantRows
    .filter((row) => row.organizationId)
    .map((row) => ({
      participantId: row.id,
      participantRole: row.role,
      id: row.organizationId!,
      name: row.organizationName ?? "",
      type: row.organizationType ?? "",
      phone: row.organizationPhone,
    }));

  return {
    caseRecord: {
      id: caseRecord.id,
      matterName: caseRecord.matterName,
      status: caseRecord.status,
      assignedUserId: caseRecord.assignedUserId,
      createdAt: caseRecord.createdAt.toISOString(),
    },
    firmUsers,
    people: peopleOnCase,
    organizations: organizationsOnCase,
    workflows: runRows.map((run) => ({
      id: run.id,
      title: run.title,
      status: run.status,
      summary: run.summary,
      updatedAt: run.updatedAt.toISOString(),
    })),
    contactAttempts: attemptRows.map((attempt) => ({
      id: attempt.id,
      workflowRunId: attempt.workflowRunId,
      channel: attempt.channel,
      outcome: attempt.outcome,
      summary: attempt.summary,
      syntheticResponse: attempt.syntheticResponse,
      attemptedAt: attempt.attemptedAt.toISOString(),
    })),
    reviews: reviewRows.map((review) => ({
      id: review.id,
      workflowRunId: review.workflowRunId,
      status: review.status,
      reason: review.reason,
      severity: review.severity,
      summary: review.summary,
      recommendedAction: review.recommendedAction,
      reviewerNote: review.reviewerNote,
      createdAt: review.createdAt.toISOString(),
    })),
    phoneCalls: callRows.map((call) => ({
      id: call.id,
      workflowRunId: call.workflowRunId,
      connectionStatus: call.connectionStatus,
      twilioCallStatus: call.twilioCallStatus,
      answeredBy: call.answeredBy,
      toNumber: call.toNumber,
      fromNumber: call.fromNumber,
      timeZone: call.timeZone,
      completedAt: call.completedAt?.toISOString() ?? null,
      createdAt: call.createdAt.toISOString(),
    })),
    auditEvents: eventRows.map((event) => ({
      id: event.id,
      workflowRunId: event.workflowRunId,
      type: event.type,
      summary: event.summary,
      actorType: event.actorType,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}
