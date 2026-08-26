import type { WorkflowRunStatus } from "@/modules/workflows/types";

export type RunStateSnapshot = {
  runStatus: WorkflowRunStatus;
  awaitingCallCompletion: boolean;
  openReviewId: string | null;
  dueStepId: string | null;
  nextDueAt: number | null;
};
