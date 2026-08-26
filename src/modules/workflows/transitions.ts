import type { FollowUpDecision } from "@/modules/phone/follow-up-policy";
import type { OutboundFollowUpPort } from "./engine";
import type { WorkflowStepRecord, WorkflowStore } from "./store";
import type { WorkflowDefinition } from "./types";

export async function blockStep(
  store: WorkflowStore,
  workflowRunId: string,
  workflowStepId: string,
  attemptCount: number,
  decision: Extract<ReturnType<WorkflowDefinition["reviewPolicy"]>, { kind: "block" }>,
) {
  await store.updateStepStatus(workflowStepId, "waiting_for_human", attemptCount);
  await store.updateRunStatus(workflowRunId, "waiting_for_human", decision.summary);
  await store.createReview({ workflowRunId, workflowStepId, decision });
  await store.appendEvent({
    workflowRunId,
    type: "review.created",
    summary: decision.summary,
    actorType: "worker",
    payload: decision,
  });
}

export async function recoverClaimedStep(
  store: WorkflowStore,
  definitions: readonly WorkflowDefinition[],
  step: WorkflowStepRecord,
  error: unknown,
) {
  if (hasLiveOutboundCall(step.payload)) return;

  const retryLimit = retryLimitFor(definitions, step.stepType);
  const retryable = step.attemptCount <= retryLimit;
  const transitioned = await store.transitionClaimedStepAfterFailure(
    step.id,
    step.attemptCount,
    retryable ? "due" : "failed",
  );
  if (!transitioned) return;

  const message = errorMessage(error);
  if (!retryable) {
    await store.updateRunStatus(step.workflowRunId, "failed", message);
  }
  await store.appendEvent({
    workflowRunId: step.workflowRunId,
    type: "step.processing_failed",
    summary: retryable ? `${step.label} failed and will be retried.` : `${step.label} exhausted its retry limit.`,
    actorType: "worker",
    payload: {
      stepId: step.id,
      attemptCount: step.attemptCount,
      retryLimit,
      retryable,
      error: message,
    },
  });
}

export function retryLimitFor(definitions: readonly WorkflowDefinition[], stepType: string) {
  for (const definition of definitions) {
    const template = definition.stepTemplates.find((item) => item.type === stepType);
    if (template) return template.retryLimit;
  }
  return 0;
}

export async function placeAutoDial(
  store: WorkflowStore,
  outboundCaller: OutboundFollowUpPort,
  step: WorkflowStepRecord,
  now: Date,
) {
  await store.appendEvent({
    workflowRunId: step.workflowRunId,
    type: "step.running",
    summary: `${step.label} started with an automatic outbound call.`,
    actorType: "worker",
    payload: { stepId: step.id, stepType: step.stepType, autoDial: true },
  });
  const placed = await outboundCaller.placeCall({
    workflowRunId: step.workflowRunId,
    stepId: step.id,
    now,
  });
  await store.updateStepPayload(step.id, { outboundCallId: placed.callId, awaitingCallCompletion: true });
}

export function serializeDecision(decision: FollowUpDecision) {
  return {
    action: decision.action,
    reason: decision.reason,
    policyId: decision.policyId,
    dueAt: decision.dueAt?.toISOString() ?? null,
    metadata: decision.metadata,
  };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown workflow processing error.";
}

export function payloadBoolean(payload: unknown, key: string, fallback: boolean) {
  if (!isPayload(payload)) return fallback;
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
}

export function hasLiveOutboundCall(payload: unknown) {
  return isPayload(payload) && typeof payload.outboundCallId === "string" && payload.awaitingCallCompletion === true;
}

export function isPayload(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}
