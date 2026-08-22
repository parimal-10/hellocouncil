import { desc, eq } from "drizzle-orm";

export async function getDashboardData() {
  const { db, humanReviewRequests, workflowEvents, workflowRuns, workflowSteps } = await loadDashboardDatabase();
  const runs = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.updatedAt)).limit(12);
  const reviews = await db.select().from(humanReviewRequests).where(eq(humanReviewRequests.status, "open")).limit(12);
  const dueSteps = await db.select().from(workflowSteps).where(eq(workflowSteps.status, "due")).limit(12);
  const events = await db.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(12);

  return {
    runs,
    reviews,
    dueSteps,
    events,
    counts: {
      activeRuns: runs.filter((run) => run.status === "active").length,
      blockedRuns: runs.filter((run) => run.status === "waiting_for_human").length,
      openReviews: reviews.length,
      dueSteps: dueSteps.length,
    },
  };
}

export async function getWorkflowDetail(id: string) {
  const { db, cases, contactAttempts, humanReviewRequests, workflowEvents, workflowRuns, workflowSteps } = await loadDashboardDatabase();
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
  if (!run) return null;

  const [caseRecord] = await db.select().from(cases).where(eq(cases.id, run.caseId));
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowRunId, id));
  const reviews = await db.select().from(humanReviewRequests).where(eq(humanReviewRequests.workflowRunId, id));
  const attempts = await db.select().from(contactAttempts).where(eq(contactAttempts.workflowRunId, id));
  const events = await db
    .select()
    .from(workflowEvents)
    .where(eq(workflowEvents.workflowRunId, id))
    .orderBy(desc(workflowEvents.occurredAt));

  return { run, caseRecord, steps, reviews, attempts, events };
}

export async function getOpenReviews() {
  const { db, humanReviewRequests } = await loadDashboardDatabase();
  return db.select().from(humanReviewRequests).where(eq(humanReviewRequests.status, "open"));
}

async function loadDashboardDatabase() {
  const [{ db }, schema] = await Promise.all([import("@/db/client"), import("@/db/schema")]);
  return { db, ...schema };
}
