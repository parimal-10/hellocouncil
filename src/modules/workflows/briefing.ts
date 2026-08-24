import { getWorkflowDefinition } from "./definitions";
import type { WorkflowDefinition, WorkflowDefinitionId } from "./types";

export type WorkflowBriefing = {
  currentStatus: string;
  whatHappened: string[];
  nextSteps: string[];
  nextFollowUp: { label: string; dueAt: Date; status: string } | null;
  openReviews: Array<{ id: string; reason: string; summary: string }>;
  validStepTypes: string[];
  canRunFollowUpNow: boolean;
  spokenSummary: string;
  agentContext: string;
};

export type WorkflowBriefingSnapshot = {
  run: { status: string; title: string; summary: string; definitionId: string };
  definition: WorkflowDefinition;
  context?: {
    matterName: string;
    clientName: string;
    providerName?: string;
    assignedUserName: string;
  };
  steps: Array<{ id: string; label: string; status: string; dueAt: Date; stepType: string }>;
  reviews: Array<{ id: string; status: string; reason: string; summary: string }>;
  attempts: Array<{ channel: string; outcome: string; summary: string }>;
  events: Array<{ type: string; summary: string; occurredAt: Date }>;
  now?: Date;
};

export function buildWorkflowBriefing(input: WorkflowBriefingSnapshot): WorkflowBriefing {
  const now = input.now ?? new Date();
  const matter = input.context?.matterName ?? input.run.title;
  const openReviews = input.reviews
    .filter((review) => review.status === "open" || review.status === "assigned")
    .map((review) => ({ id: review.id, reason: review.reason, summary: review.summary }));
  const nextFollowUp = [...input.steps]
    .filter((step) => step.status === "due")
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())[0] ?? null;
  const whatHappened = [...input.events]
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .slice(-8)
    .map((event) => `${event.type}: ${event.summary}`);
  const currentStatus = statusLine({
    matter,
    run: input.run,
    nextFollowUp,
    openReviews,
    now,
  });
  const nextSteps = plannedNextSteps({
    runStatus: input.run.status,
    nextFollowUp,
    openReviews,
    now,
  });
  const spokenSummary = [
    currentStatus,
    nextFollowUp
      ? nextFollowUp.dueAt <= now
        ? `The next follow-up is ${nextFollowUp.label}, due now.`
        : `The next follow-up is ${nextFollowUp.label}, scheduled for ${nextFollowUp.dueAt.toISOString()}.`
      : "No follow-up is currently scheduled.",
    openReviews[0] ? `Open review: ${openReviews[0].reason}. ${openReviews[0].summary}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    currentStatus,
    whatHappened,
    nextSteps,
    nextFollowUp: nextFollowUp
      ? { label: nextFollowUp.label, dueAt: nextFollowUp.dueAt, status: nextFollowUp.status }
      : null,
    openReviews,
    validStepTypes: input.definition.stepTemplates.map((step) => step.type),
    canRunFollowUpNow: input.run.status === "active",
    spokenSummary,
    agentContext: [
      `Case: ${matter}.`,
      input.context
        ? `Client: ${input.context.clientName}.${input.context.providerName ? ` Provider: ${input.context.providerName}.` : ""} Owner: ${input.context.assignedUserName}.`
        : "",
      `Workflow: ${input.definition.label} (${input.definition.id}).`,
      `Run status: ${input.run.status}.`,
      `Latest summary: ${input.run.summary || "None"}.`,
      `Valid follow-up step types: ${input.definition.stepTemplates.map((step) => step.type).join(", ")}.`,
      nextFollowUp
        ? `Next scheduled follow-up: ${nextFollowUp.label} (${nextFollowUp.stepType}) at ${nextFollowUp.dueAt.toISOString()}.`
        : "No follow-up is scheduled.",
      openReviews.length > 0
        ? `Open reviews: ${openReviews.map((review) => `${review.id} (${review.reason})`).join("; ")}.`
        : "No open reviews.",
      `You can run a follow-up now: ${input.run.status === "active" ? "yes" : "no"}.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export async function loadWorkflowBriefing(workflowRunId: string, now = new Date()): Promise<WorkflowBriefing> {
  const { getWorkflowDetail } = await import("@/modules/dashboard/queries");
  const detail = await getWorkflowDetail(workflowRunId);
  if (!detail) {
    throw new Error(`Workflow run not found: ${workflowRunId}`);
  }

  return buildWorkflowBriefing({
    run: detail.run,
    definition: getWorkflowDefinition(detail.run.definitionId as WorkflowDefinitionId),
    context: detail.context,
    steps: detail.steps,
    reviews: detail.reviews,
    attempts: detail.attempts,
    events: detail.events,
    now,
  });
}

function statusLine(input: {
  matter: string;
  run: { status: string; summary: string };
  nextFollowUp: { label: string; dueAt: Date } | null;
  openReviews: Array<{ summary: string }>;
  now: Date;
}) {
  if (input.run.status === "waiting_for_human") {
    return `${input.matter} is waiting for human review${input.openReviews[0] ? `: ${input.openReviews[0].summary}` : "."}`;
  }
  if (input.nextFollowUp && input.nextFollowUp.dueAt <= input.now) {
    return `${input.matter} has a ${input.nextFollowUp.label} due now. ${input.run.summary}`.trim();
  }
  if (input.nextFollowUp) {
    return `${input.matter} is ${input.run.status}. Next follow-up: ${input.nextFollowUp.label} on ${input.nextFollowUp.dueAt.toISOString()}. ${input.run.summary}`.trim();
  }
  return `${input.matter} is ${input.run.status}. ${input.run.summary}`.trim();
}

function plannedNextSteps(input: {
  runStatus: string;
  nextFollowUp: { label: string; dueAt: Date } | null;
  openReviews: Array<{ summary: string }>;
  now: Date;
}) {
  const steps: string[] = [];
  if (input.openReviews[0]) {
    steps.push(`Human review must be resolved before outreach continues: ${input.openReviews[0].summary}`);
  }
  if (input.nextFollowUp) {
    steps.push(
      input.nextFollowUp.dueAt <= input.now
        ? `${input.nextFollowUp.label} is due now and can be run immediately.`
        : `${input.nextFollowUp.label} is scheduled for ${input.nextFollowUp.dueAt.toISOString()}.`,
    );
  } else if (input.runStatus === "active") {
    steps.push("No follow-up is scheduled. The agent can start one now.");
  } else if (input.runStatus === "completed") {
    steps.push("No further follow-ups are planned.");
  }
  return steps;
}
