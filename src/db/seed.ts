import { db, pool } from "./client";
import {
  caseParticipants,
  cases,
  contactAttempts,
  humanReviewRequests,
  organizations,
  people,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "./schema";

async function main() {
  const [attorney] = await db.insert(people).values({
    name: "Maya Singh",
    role: "firm_user",
    email: "maya@hellocounsel.local",
  }).returning();

  const [clientA] = await db.insert(people).values({
    name: "Jordan Lee",
    role: "client",
    phone: "555-0101",
  }).returning();

  const [clientB] = await db.insert(people).values({
    name: "Elena Park",
    role: "client",
    phone: "555-0102",
  }).returning();

  const [provider] = await db.insert(organizations).values({
    name: "Northside Imaging",
    type: "medical_provider",
    phone: "555-0199",
  }).returning();

  const [caseA] = await db.insert(cases).values({
    matterName: "Lee v. Metro Transit",
    status: "active",
    assignedUserId: attorney.id,
  }).returning();

  const [caseB] = await db.insert(cases).values({
    matterName: "Park v. Oak Logistics",
    status: "active",
    assignedUserId: attorney.id,
  }).returning();

  await db.insert(caseParticipants).values([
    { caseId: caseA.id, personId: clientA.id, role: "client" },
    { caseId: caseA.id, organizationId: provider.id, role: "medical_provider" },
    { caseId: caseB.id, personId: clientB.id, role: "client" },
  ]);

  const [medicalRun] = await db.insert(workflowRuns).values({
    definitionId: "medical-records-follow-up",
    caseId: caseA.id,
    status: "waiting_for_human",
    title: "Northside Imaging records follow-up",
    summary: "Provider refused release until authorization is verified.",
  }).returning();

  const [clientRun] = await db.insert(workflowRuns).values({
    definitionId: "client-check-in",
    caseId: caseB.id,
    status: "active",
    title: "Monthly client check-in",
    summary: "Next check-in is due.",
  }).returning();

  const [blockedStep] = await db.insert(workflowSteps).values({
    workflowRunId: medicalRun.id,
    stepType: "provider_follow_up",
    label: "Follow up with provider",
    status: "waiting_for_human",
    dueAt: new Date(Date.now() - 60 * 60 * 1000),
    attemptCount: 2,
    payload: { providerName: provider.name },
  }).returning();

  await db.insert(workflowSteps).values({
    workflowRunId: clientRun.id,
    stepType: "client_check_in",
    label: "Check in with client",
    status: "due",
    dueAt: new Date(Date.now() - 30 * 60 * 1000),
    attemptCount: 0,
    payload: { clientName: clientB.name },
  });

  await db.insert(humanReviewRequests).values({
    workflowRunId: medicalRun.id,
    workflowStepId: blockedStep.id,
    status: "open",
    reason: "provider_refusal",
    severity: "high",
    summary: "Provider said they cannot release records without a verified authorization.",
    recommendedAction: "Verify authorization and contact Northside Imaging.",
  });

  await db.insert(contactAttempts).values({
    workflowRunId: medicalRun.id,
    workflowStepId: blockedStep.id,
    channel: "phone",
    outcome: "refused",
    summary: "Provider refused to release records.",
    syntheticResponse: "We cannot release anything without a new authorization.",
  });

  await db.insert(workflowEvents).values([
    {
      workflowRunId: medicalRun.id,
      type: "workflow.started",
      summary: "Medical records follow-up started.",
      actorType: "system",
      payload: {},
    },
    {
      workflowRunId: medicalRun.id,
      type: "review.created",
      summary: "Human review created for provider refusal.",
      actorType: "worker",
      payload: { reason: "provider_refusal" },
    },
    {
      workflowRunId: clientRun.id,
      type: "workflow.started",
      summary: "Client check-in workflow started.",
      actorType: "system",
      payload: {},
    },
  ]);

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
