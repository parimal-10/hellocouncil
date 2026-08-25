import { sql } from "drizzle-orm";
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

const hour = 60 * 60 * 1000;

function at(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * hour);
}

async function main() {
  await db.execute(sql`
    truncate table
      phone_calls,
      voice_session_events,
      voice_sessions,
      contact_attempts,
      human_review_requests,
      workflow_events,
      workflow_steps,
      workflow_runs,
      case_participants,
      cases,
      organizations,
      people
    cascade
  `);

  const [attorney] = await db.insert(people).values({
    name: "Maya Singh",
    role: "firm_user",
    email: "maya@hellocounsel.local",
  }).returning();

  const [jordan, priya, marcus, elena, sam, hannah] = await db.insert(people).values([
    { name: "Jordan Lee", role: "client", phone: "+13125550101", timeZone: "America/Chicago", timeZoneSource: "explicit" },
    { name: "Priya Shah", role: "client", phone: "+12125550103", timeZone: "America/New_York", timeZoneSource: "explicit" },
    { name: "Marcus Cole", role: "client", phone: "+14155550104", timeZone: "America/Los_Angeles", timeZoneSource: "explicit" },
    { name: "Elena Park", role: "client", phone: "+13055550102", timeZone: "America/New_York", timeZoneSource: "explicit" },
    { name: "Sam Rivera", role: "client", phone: "+16025550105", timeZone: "America/Phoenix", timeZoneSource: "explicit" },
    { name: "Hannah Ortiz", role: "client", phone: "+12065550106", timeZone: "America/Los_Angeles", timeZoneSource: "explicit" },
  ]).returning();

  const [northside, harbor, westlake] = await db.insert(organizations).values([
    { name: "Northside Imaging", type: "medical_provider", phone: "555-0199" },
    { name: "Harbor Orthopedics", type: "medical_provider", phone: "555-0188" },
    { name: "Westlake Medical Records", type: "medical_provider", phone: "555-0177" },
  ]).returning();

  const [leeCase, shahCase, coleCase, parkCase, riveraCase, ortizCase] = await db.insert(cases).values([
    { matterName: "Lee v. Metro Transit", status: "active", assignedUserId: attorney.id },
    { matterName: "Shah v. Lakeside Motors", status: "active", assignedUserId: attorney.id },
    { matterName: "Cole v. Summit Delivery", status: "active", assignedUserId: attorney.id },
    { matterName: "Park v. Oak Logistics", status: "active", assignedUserId: attorney.id },
    { matterName: "Rivera v. Pine Ridge", status: "active", assignedUserId: attorney.id },
    { matterName: "Ortiz v. Harbor Transit", status: "active", assignedUserId: attorney.id },
  ]).returning();

  await db.insert(caseParticipants).values([
    { caseId: leeCase.id, personId: jordan.id, role: "client" },
    { caseId: leeCase.id, organizationId: northside.id, role: "medical_provider" },
    { caseId: shahCase.id, personId: priya.id, role: "client" },
    { caseId: shahCase.id, organizationId: harbor.id, role: "medical_provider" },
    { caseId: coleCase.id, personId: marcus.id, role: "client" },
    { caseId: coleCase.id, organizationId: westlake.id, role: "medical_provider" },
    { caseId: parkCase.id, personId: elena.id, role: "client" },
    { caseId: riveraCase.id, personId: sam.id, role: "client" },
    { caseId: ortizCase.id, personId: hannah.id, role: "client" },
  ]);

  const [leeRun] = await db.insert(workflowRuns).values({
    definitionId: "medical-records-follow-up",
    caseId: leeCase.id,
    status: "waiting_for_human",
    title: "Northside Imaging records follow-up",
    summary: "Provider refused release until authorization is verified.",
    startedAt: at(-96),
  }).returning();

  const [shahRun] = await db.insert(workflowRuns).values({
    definitionId: "medical-records-follow-up",
    caseId: shahCase.id,
    status: "active",
    title: "Harbor Orthopedics records follow-up",
    summary: "Harbor confirmed the request is in queue. Next call is scheduled.",
    startedAt: at(-72),
  }).returning();

  const [coleRun] = await db.insert(workflowRuns).values({
    definitionId: "medical-records-follow-up",
    caseId: coleCase.id,
    status: "active",
    title: "Westlake records follow-up",
    summary: "Westlake said records should be ready Friday. Confirm on the scheduled follow-up.",
    startedAt: at(-48),
  }).returning();

  const [parkRun] = await db.insert(workflowRuns).values({
    definitionId: "client-check-in",
    caseId: parkCase.id,
    status: "active",
    title: "Overdue monthly check-in",
    summary: "Elena missed the last check-in window. Outreach is due now.",
    startedAt: at(-80),
  }).returning();

  const [riveraRun] = await db.insert(workflowRuns).values({
    definitionId: "client-check-in",
    caseId: riveraCase.id,
    status: "active",
    title: "Recovery check-in",
    summary: "Sam reported improvement at the last check-in. Next check-in is scheduled.",
    startedAt: at(-120),
  }).returning();

  const [ortizRun] = await db.insert(workflowRuns).values({
    definitionId: "client-check-in",
    caseId: ortizCase.id,
    status: "waiting_for_human",
    title: "Ambiguous client check-in",
    summary: "Hannah's last response was unclear and needs a firm teammate.",
    startedAt: at(-36),
  }).returning();

  const [leeBlocked] = await db.insert(workflowSteps).values({
    workflowRunId: leeRun.id,
    stepType: "provider_follow_up",
    label: "Follow up with provider",
    status: "waiting_for_human",
    dueAt: at(-2),
    attemptCount: 2,
    payload: { providerName: northside.name },
    createdAt: at(-96),
  }).returning();

  await db.insert(workflowSteps).values([
    {
      workflowRunId: shahRun.id,
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "completed",
      dueAt: at(-24),
      attemptCount: 1,
      payload: { providerName: harbor.name },
      createdAt: at(-72),
    },
    {
      workflowRunId: shahRun.id,
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "due",
      dueAt: at(18),
      attemptCount: 0,
      payload: { providerName: harbor.name, reason: "Call back after records desk processes the request." },
      createdAt: at(-24),
    },
    {
      workflowRunId: coleRun.id,
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "completed",
      dueAt: at(-20),
      attemptCount: 1,
      payload: { providerName: westlake.name },
      createdAt: at(-48),
    },
    {
      workflowRunId: coleRun.id,
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "due",
      dueAt: at(48),
      attemptCount: 0,
      payload: { providerName: westlake.name, reason: "Confirm Friday release." },
      createdAt: at(-20),
    },
    {
      workflowRunId: parkRun.id,
      stepType: "client_check_in",
      label: "Check in with client",
      status: "due",
      dueAt: at(-0.5),
      attemptCount: 0,
      payload: { clientName: elena.name },
      createdAt: at(-80),
    },
    {
      workflowRunId: riveraRun.id,
      stepType: "client_check_in",
      label: "Check in with client",
      status: "completed",
      dueAt: at(-72),
      attemptCount: 1,
      payload: { clientName: sam.name },
      createdAt: at(-120),
    },
    {
      workflowRunId: riveraRun.id,
      stepType: "client_check_in",
      label: "Check in with client",
      status: "due",
      dueAt: at(72),
      attemptCount: 0,
      payload: { clientName: sam.name, reason: "Routine three-day follow-up." },
      createdAt: at(-72),
    },
  ]);

  const [ortizBlocked] = await db.insert(workflowSteps).values({
    workflowRunId: ortizRun.id,
    stepType: "client_check_in",
    label: "Check in with client",
    status: "waiting_for_human",
    dueAt: at(-4),
    attemptCount: 1,
    payload: { clientName: hannah.name },
    createdAt: at(-36),
  }).returning();

  await db.insert(humanReviewRequests).values([
    {
      workflowRunId: leeRun.id,
      workflowStepId: leeBlocked.id,
      status: "open",
      reason: "provider_refusal",
      severity: "high",
      summary: "Provider said they cannot release records without a verified authorization.",
      recommendedAction: "Verify authorization and contact Northside Imaging.",
      createdAt: at(-2),
    },
    {
      workflowRunId: ortizRun.id,
      workflowStepId: ortizBlocked.id,
      status: "open",
      reason: "ambiguous_client_response",
      severity: "medium",
      summary: "Hannah said she was not sure how treatment was going and maybe needed to talk to someone.",
      recommendedAction: "Review the client response and decide whether a paralegal should call.",
      createdAt: at(-4),
    },
  ]);

  await db.insert(contactAttempts).values([
    {
      workflowRunId: leeRun.id,
      workflowStepId: leeBlocked.id,
      channel: "phone",
      outcome: "refused",
      summary: "Provider refused to release records.",
      attemptedAt: at(-2),
    },
    {
      workflowRunId: shahRun.id,
      channel: "phone",
      outcome: "reached",
      summary: "Harbor said the request is in the records queue.",
      attemptedAt: at(-24),
    },
    {
      workflowRunId: coleRun.id,
      channel: "phone",
      outcome: "reached",
      summary: "Westlake said records should be ready Friday.",
      attemptedAt: at(-20),
    },
    {
      workflowRunId: riveraRun.id,
      channel: "phone",
      outcome: "reached",
      summary: "Sam reported recovery is improving and had no questions.",
      attemptedAt: at(-72),
    },
    {
      workflowRunId: ortizRun.id,
      workflowStepId: ortizBlocked.id,
      channel: "phone",
      outcome: "reached",
      summary: "Hannah's update was ambiguous.",
      attemptedAt: at(-4),
    },
  ]);

  await db.insert(workflowEvents).values([
    {
      workflowRunId: leeRun.id,
      type: "workflow.started",
      summary: "Medical records follow-up started for Northside Imaging.",
      actorType: "system",
      payload: {},
      occurredAt: at(-96),
    },
    {
      workflowRunId: leeRun.id,
      type: "step.running",
      summary: "Follow up with provider started.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-2.1),
    },
    {
      workflowRunId: leeRun.id,
      type: "review.created",
      summary: "Human review created for provider refusal.",
      actorType: "worker",
      payload: { reason: "provider_refusal" },
      occurredAt: at(-2),
    },
    {
      workflowRunId: shahRun.id,
      type: "workflow.started",
      summary: "Medical records follow-up started for Harbor Orthopedics.",
      actorType: "system",
      payload: {},
      occurredAt: at(-72),
    },
    {
      workflowRunId: shahRun.id,
      type: "step.completed",
      summary: "Harbor confirmed the request is in queue.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-24),
    },
    {
      workflowRunId: shahRun.id,
      type: "step.scheduled",
      summary: "Follow up with provider scheduled.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-24),
    },
    {
      workflowRunId: coleRun.id,
      type: "workflow.started",
      summary: "Medical records follow-up started for Westlake.",
      actorType: "system",
      payload: {},
      occurredAt: at(-48),
    },
    {
      workflowRunId: coleRun.id,
      type: "step.completed",
      summary: "Westlake said records should be ready Friday.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-20),
    },
    {
      workflowRunId: coleRun.id,
      type: "step.scheduled",
      summary: "Friday confirmation follow-up scheduled.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-20),
    },
    {
      workflowRunId: parkRun.id,
      type: "workflow.started",
      summary: "Client check-in workflow started.",
      actorType: "system",
      payload: {},
      occurredAt: at(-80),
    },
    {
      workflowRunId: parkRun.id,
      type: "step.scheduled",
      summary: "Check in with client became due.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-0.5),
    },
    {
      workflowRunId: riveraRun.id,
      type: "workflow.started",
      summary: "Client check-in workflow started.",
      actorType: "system",
      payload: {},
      occurredAt: at(-120),
    },
    {
      workflowRunId: riveraRun.id,
      type: "step.completed",
      summary: "Sam reported recovery is improving.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-72),
    },
    {
      workflowRunId: riveraRun.id,
      type: "step.scheduled",
      summary: "Next client check-in scheduled.",
      actorType: "worker",
      payload: {},
      occurredAt: at(-72),
    },
    {
      workflowRunId: ortizRun.id,
      type: "workflow.started",
      summary: "Client check-in workflow started.",
      actorType: "system",
      payload: {},
      occurredAt: at(-36),
    },
    {
      workflowRunId: ortizRun.id,
      type: "review.created",
      summary: "Human review created for an ambiguous client response.",
      actorType: "worker",
      payload: { reason: "ambiguous_client_response" },
      occurredAt: at(-4),
    },
  ]);

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
