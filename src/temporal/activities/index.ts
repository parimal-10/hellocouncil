import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { humanReviewRequests, workflowRuns } from "@/db/schema";
import { advanceDueStep } from "@/modules/workflows/execution";
import { workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
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

export async function executeDueStep(input: { stepId: string }) {
  return advanceDueStep(
    { store: new DrizzleWorkflowStore(), outboundCaller: createWorkerOutboundDialer() },
    input.stepId,
    new Date(),
  );
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

async function listOpenReviewIdsForRun(workflowRunId: string): Promise<Array<{ id: string }>> {
  return db
    .select({ id: humanReviewRequests.id })
    .from(humanReviewRequests)
    .where(
      and(
        eq(humanReviewRequests.workflowRunId, workflowRunId),
        eq(humanReviewRequests.status, "open"),
      ),
    )
    .orderBy(asc(humanReviewRequests.createdAt));
}
