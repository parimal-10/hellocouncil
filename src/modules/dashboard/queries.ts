import { asc, desc, eq, inArray } from "drizzle-orm";

type CaseContext = {
  caseId: string;
  matterName: string;
  clientName: string;
  providerName?: string;
  assignedUserName: string;
};

type DashboardDatabase = Awaited<ReturnType<typeof loadDashboardDatabase>>;

export async function getDashboardData() {
  const database = await loadDashboardDatabase();
  const { db, humanReviewRequests, workflowEvents, workflowRuns, workflowSteps } = database;
  const [runs, reviewRows, dueStepRows, events] = await Promise.all([
    db.select().from(workflowRuns).orderBy(desc(workflowRuns.updatedAt)).limit(12),
    db
      .select({ review: humanReviewRequests, run: workflowRuns })
      .from(humanReviewRequests)
      .innerJoin(workflowRuns, eq(humanReviewRequests.workflowRunId, workflowRuns.id))
      .where(inArray(humanReviewRequests.status, ["open", "assigned"]))
      .orderBy(desc(humanReviewRequests.createdAt))
      .limit(12),
    db
      .select({ step: workflowSteps, run: workflowRuns })
      .from(workflowSteps)
      .innerJoin(workflowRuns, eq(workflowSteps.workflowRunId, workflowRuns.id))
      .where(eq(workflowSteps.status, "due"))
      .orderBy(asc(workflowSteps.dueAt))
      .limit(12),
    db.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(12),
  ]);
  const contexts = await getCaseContexts(
    database,
    [...runs, ...reviewRows.map((row) => row.run), ...dueStepRows.map((row) => row.run)].map((run) => run.caseId),
  );

  return {
    runs: runs.map((run) => ({ ...run, context: contexts.get(run.caseId) })),
    reviews: reviewRows.map(({ review, run }) => ({ ...review, runTitle: run.title, context: contexts.get(run.caseId) })),
    dueSteps: dueStepRows.map(({ step, run }) => ({ ...step, runTitle: run.title, context: contexts.get(run.caseId) })),
    events,
    counts: {
      activeRuns: runs.filter((run) => run.status === "active").length,
      blockedRuns: runs.filter((run) => run.status === "waiting_for_human").length,
      openReviews: reviewRows.length,
      dueSteps: dueStepRows.length,
    },
  };
}

export async function getWorkflowDetail(id: string) {
  const database = await loadDashboardDatabase();
  const { db, cases, contactAttempts, humanReviewRequests, workflowEvents, workflowRuns, workflowSteps } = database;
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  if (!run) return null;

  const [[caseRecord], steps, reviews, attempts, events, contexts] = await Promise.all([
    db.select().from(cases).where(eq(cases.id, run.caseId)),
    db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, id)).orderBy(asc(workflowSteps.dueAt)),
    db.select().from(humanReviewRequests).where(eq(humanReviewRequests.workflowRunId, id)).orderBy(desc(humanReviewRequests.createdAt)),
    db.select().from(contactAttempts).where(eq(contactAttempts.workflowRunId, id)).orderBy(desc(contactAttempts.attemptedAt)),
    db.select().from(workflowEvents).where(eq(workflowEvents.workflowRunId, id)).orderBy(desc(workflowEvents.occurredAt)),
    getCaseContexts(database, [run.caseId]),
  ]);

  return { run, caseRecord, context: contexts.get(run.caseId), steps, reviews, attempts, events };
}

export async function getReviewQueue() {
  const database = await loadDashboardDatabase();
  const { db, humanReviewRequests, people, workflowRuns } = database;
  const [reviewRows, firmUsers] = await Promise.all([
    db
      .select({ review: humanReviewRequests, run: workflowRuns })
      .from(humanReviewRequests)
      .innerJoin(workflowRuns, eq(humanReviewRequests.workflowRunId, workflowRuns.id))
      .where(inArray(humanReviewRequests.status, ["open", "assigned"]))
      .orderBy(desc(humanReviewRequests.createdAt)),
    db.select({ id: people.id, name: people.name }).from(people).where(eq(people.role, "firm_user")).orderBy(asc(people.name)),
  ]);
  const contexts = await getCaseContexts(
    database,
    reviewRows.map((row) => row.run.caseId),
  );

  return {
    reviews: reviewRows.map(({ review, run }) => ({ ...review, runTitle: run.title, context: contexts.get(run.caseId) })),
    firmUsers,
  };
}

async function getCaseContexts(database: DashboardDatabase, caseIds: string[]) {
  const uniqueCaseIds = [...new Set(caseIds)];
  if (uniqueCaseIds.length === 0) return new Map<string, CaseContext>();

  const { caseParticipants, cases, db, organizations, people } = database;
  const caseRows = await db
    .select({ id: cases.id, matterName: cases.matterName, assignedUserId: cases.assignedUserId })
    .from(cases)
    .where(inArray(cases.id, uniqueCaseIds));
  const [owners, participants] = await Promise.all([
    db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, caseRows.map((row) => row.assignedUserId))),
    db
      .select({
        caseId: caseParticipants.caseId,
        role: caseParticipants.role,
        personName: people.name,
        organizationName: organizations.name,
      })
      .from(caseParticipants)
      .leftJoin(people, eq(caseParticipants.personId, people.id))
      .leftJoin(organizations, eq(caseParticipants.organizationId, organizations.id))
      .where(inArray(caseParticipants.caseId, uniqueCaseIds)),
  ]);
  const ownersById = new Map(owners.map((owner) => [owner.id, owner.name]));

  return new Map(
    caseRows.map((caseRecord) => {
      const caseParticipants = participants.filter((participant) => participant.caseId === caseRecord.id);
      const client = caseParticipants.find((participant) => participant.role === "client");
      const provider = caseParticipants.find((participant) => participant.role === "medical_provider" || participant.role === "provider");
      return [
        caseRecord.id,
        {
          caseId: caseRecord.id,
          matterName: caseRecord.matterName,
          clientName: client?.personName ?? "Unknown client",
          providerName: provider?.organizationName ?? provider?.personName ?? undefined,
          assignedUserName: ownersById.get(caseRecord.assignedUserId) ?? "Unassigned",
        },
      ];
    }),
  );
}

async function loadDashboardDatabase() {
  const [{ db }, schema] = await Promise.all([import("@/db/client"), import("@/db/schema")]);
  return { db, ...schema };
}
