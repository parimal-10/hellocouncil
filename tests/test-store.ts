import type {
  AppendWorkflowEventInput,
  CreateReviewInput,
  ReviewRequestRecord,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowStore,
} from "@/modules/workflows/store";
import type { WorkflowRunStatus, WorkflowStepStatus } from "@/modules/workflows/types";

export class TestWorkflowStore implements WorkflowStore {
  runs = new Map<string, WorkflowRunRecord>();
  steps = new Map<string, WorkflowStepRecord>();
  people = new Map<string, { id: string; role: string }>();
  events: AppendWorkflowEventInput[] = [];
  reviews: Array<CreateReviewInput & { id: string; status: string; note?: string }> = [];
  contactAttempts: Array<Record<string, unknown>> = [];

  async getRun(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run;
  }

  async listSteps(workflowRunId: string) {
    return [...this.steps.values()]
      .filter((step) => step.workflowRunId === workflowRunId)
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
  }

  async getStep(id: string) {
    const step = this.steps.get(id);
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step;
  }

  async getReview(id: string): Promise<ReviewRequestRecord> {
    const review = this.reviews.find((item) => item.id === id);
    if (!review) throw new Error(`Review not found: ${id}`);
    return {
      id: review.id,
      workflowRunId: review.workflowRunId,
      workflowStepId: review.workflowStepId ?? null,
      status: review.status as ReviewRequestRecord["status"],
      assignedUserId: null,
      reason: review.decision.reason,
    };
  }

  async isAssignableFirmUser(id: string) {
    return this.people.get(id)?.role === "firm_user";
  }

  async claimDueStep(id: string, now: Date) {
    const step = this.steps.get(id);
    if (!step || step.status !== "due" || step.dueAt > now) return null;

    const claimedStep = { ...step, status: "running" as const, attemptCount: step.attemptCount + 1 };
    this.steps.set(id, claimedStep);
    return claimedStep;
  }

  async updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string) {
    const run = await this.getRun(id);
    this.runs.set(id, { ...run, status, summary: summary ?? run.summary });
  }

  async updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number) {
    const step = await this.getStep(id);
    this.steps.set(id, { ...step, status, attemptCount: attemptCount ?? step.attemptCount });
  }

  async updateStepPayload(id: string, patch: Record<string, unknown>) {
    const step = await this.getStep(id);
    const payload = typeof step.payload === "object" && step.payload !== null ? step.payload : {};
    this.steps.set(id, { ...step, payload: { ...payload, ...patch } });
  }

  async transitionClaimedStepAfterFailure(id: string, attemptCount: number, status: "due" | "failed") {
    const step = await this.getStep(id);
    if (step.status !== "running" || step.attemptCount !== attemptCount) return false;
    this.steps.set(id, { ...step, status });
    return true;
  }

  async rescheduleStep(id: string, dueAt: Date) {
    const step = await this.getStep(id);
    this.steps.set(id, { ...step, status: "due", dueAt });
  }

  async createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }) {
    const step: WorkflowStepRecord = {
      id: `step-${this.steps.size + 1}`,
      workflowRunId: input.workflowRunId,
      stepType: input.stepType,
      label: input.label,
      status: "due",
      dueAt: input.dueAt,
      attemptCount: 0,
      payload: input.payload ?? {},
    };
    this.steps.set(step.id, step);
    return step;
  }

  async appendEvent(input: AppendWorkflowEventInput) {
    this.events.push(input);
  }

  async createReview(input: CreateReviewInput) {
    const id = `review-${this.reviews.length + 1}`;
    this.reviews.push({ ...input, id, status: "open" });
    return id;
  }

  async resolveReview(input: {
    reviewRequestId: string;
    status: "approved" | "edited" | "rejected" | "resolved" | "assigned";
    note: string;
    assignedUserId?: string;
  }) {
    const review = this.reviews.find((item) => item.id === input.reviewRequestId);
    if (!review) throw new Error(`Review not found: ${input.reviewRequestId}`);
    if (review.status !== "open" && review.status !== "assigned") {
      throw new Error(`Review ${input.reviewRequestId} is not open or assigned.`);
    }
    review.status = input.status;
    review.note = input.note;
    if (input.assignedUserId) {
      Object.assign(review, { assignedUserId: input.assignedUserId });
    }
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string }) {
    this.contactAttempts.push(input);
  }

}
