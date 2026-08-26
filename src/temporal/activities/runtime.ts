import { advanceDueStep, type ExecutionDeps, type ExecuteStepOutcome } from "@/modules/workflows/execution";
import type { WorkflowEngine } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";
import { applyOutboundCallFollowUp } from "@/modules/phone/orchestration";
import { isTerminalConnectionStatus } from "@/modules/phone/status";
import type { PhoneCallStore } from "@/modules/phone/types";
import type { RunStateSnapshot } from "./types";

export type LoadRunStateDeps = {
  workflowStore: Pick<WorkflowStore, "getRun" | "listSteps">;
  listOpenReviews(workflowRunId: string): Promise<Array<{ id: string }>>;
};

export function makeLoadRunState(deps: LoadRunStateDeps) {
  return async function loadRunState(input: {
    workflowRunId: string;
    now?: Date;
  }): Promise<RunStateSnapshot> {
    const now = input.now ?? new Date();
    const run = await deps.workflowStore.getRun(input.workflowRunId);
    const steps = await deps.workflowStore.listSteps(input.workflowRunId);
    const [openReview] = await deps.listOpenReviews(input.workflowRunId);

    const dueSteps = steps
      .filter((step) => step.status === "due" && step.dueAt.getTime() <= now.getTime())
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
    const futureDueAt = steps
      .filter((step) => step.status === "due" && step.dueAt.getTime() > now.getTime())
      .map((step) => step.dueAt.getTime())
      .sort((left, right) => left - right)[0];

    return {
      runStatus: run.status,
      awaitingCallCompletion: steps.some((step) => payloadBoolean(step.payload, "awaitingCallCompletion")),
      openReviewId: openReview?.id ?? null,
      // A pending human review outranks execution until it is resolved.
      dueStepId: openReview ? null : (dueSteps[0]?.id ?? null),
      nextDueAt: futureDueAt ?? null,
    };
  };
}

export function makeExecuteDueStep(deps: ExecutionDeps) {
  return async function executeDueStep(input: { stepId: string; now?: Date }): Promise<ExecuteStepOutcome> {
    return advanceDueStep(deps, input.stepId, input.now ?? new Date());
  };
}

export function makeApplyCallOutcome(deps: {
  engineFactory: () => WorkflowEngine;
  phoneStore: Pick<PhoneCallStore, "getCall" | "claimOrchestration">;
}) {
  return async function applyCallOutcome(input: { callId: string }): Promise<{ applied: boolean }> {
    const call = await deps.phoneStore.getCall(input.callId);
    if (!call || !isTerminalConnectionStatus(call.connectionStatus)) return { applied: false };
    // Mirrors the Twilio webhook: the idempotent orchestration claim happens
    // inside applyOutboundCallFollowUp, so a replayed activity is a noop.
    const decision = await applyOutboundCallFollowUp({
      call,
      now: new Date(),
      engine: deps.engineFactory(),
      phoneStore: deps.phoneStore,
    });
    return { applied: decision !== null };
  };
}

function payloadBoolean(payload: unknown, key: string): boolean {
  return typeof payload === "object" && payload !== null && (payload as Record<string, unknown>)[key] === true;
}
