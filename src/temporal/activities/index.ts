import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { humanReviewRequests, workflowRuns } from "@/db/schema";
import { advanceDueStep, type ExecuteStepOutcome } from "@/modules/workflows/execution";
import { workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
import { isAutomaticOutboundCallingEnabled } from "@/modules/phone/auto-dial";
import type { OutboundFollowUpPort } from "@/modules/phone/orchestration";
import { DrizzlePhoneCallStore } from "@/modules/phone/store";
import { createWorkerOutboundDialer } from "@/modules/phone/worker-dialer";
import { makeApplyCallOutcome, makeLoadRunState } from "./runtime";
import type { RunStateSnapshot } from "./types";

export async function loadRunState(input: { workflowRunId: string }): Promise<RunStateSnapshot> {
  return makeLoadRunState({
    workflowStore: new DrizzleWorkflowStore(),
    listOpenReviews: listOpenReviewIdsForRun,
  })(input);
}

export type ExecuteDueStepActivityDeps = {
  storeFactory: () => WorkflowStore;
  outboundCallerFactory: () => OutboundFollowUpPort;
  isAutoOutboundEnabled?: () => boolean;
};

export function makeExecuteDueStepActivity(deps: ExecuteDueStepActivityDeps) {
  return async function executeDueStep(input: { stepId: string }): Promise<ExecuteStepOutcome> {
    const isAutoOutboundEnabled = deps.isAutoOutboundEnabled ?? isAutomaticOutboundCallingEnabled;
    // No simulated fallback: when AUTO_OUTBOUND_CALLS is off the dialer must not
    // even be constructed; advanceDueStep then takes its refuse-and-recover path.
    const outboundCaller = isAutoOutboundEnabled() ? deps.outboundCallerFactory() : undefined;
    return advanceDueStep({ store: deps.storeFactory(), outboundCaller }, input.stepId, new Date());
  };
}

export async function executeDueStep(input: { stepId: string }) {
  return makeExecuteDueStepActivity({
    storeFactory: () => new DrizzleWorkflowStore(),
    outboundCallerFactory: createWorkerOutboundDialer,
  })(input);
}

export async function applyCallOutcome(input: { callId: string }): Promise<{ applied: boolean }> {
  const store = new DrizzleWorkflowStore();
  return makeApplyCallOutcome({
    engineFactory: () => new WorkflowEngine({ store, definitions: workflowDefinitions }),
    phoneStore: new DrizzlePhoneCallStore(),
  })(input);
}

export async function recordTemporalWorkflowId(input: {
  workflowRunId: string;
  temporalWorkflowId: string;
}): Promise<void> {
  await db
    .update(workflowRuns)
    .set({ temporalWorkflowId: input.temporalWorkflowId })
    .where(eq(workflowRuns.id, input.workflowRunId));
}

export const OPEN_REVIEW_STATUSES = ["open", "assigned"] as const;

export function openReviewsForRunQuery(client: typeof db, workflowRunId: string) {
  return client
    .select({ id: humanReviewRequests.id })
    .from(humanReviewRequests)
    .where(
      and(
        eq(humanReviewRequests.workflowRunId, workflowRunId),
        inArray(humanReviewRequests.status, [...OPEN_REVIEW_STATUSES]),
      ),
    )
    .orderBy(asc(humanReviewRequests.createdAt));
}

async function listOpenReviewIdsForRun(workflowRunId: string): Promise<Array<{ id: string }>> {
  return openReviewsForRunQuery(db, workflowRunId);
}
