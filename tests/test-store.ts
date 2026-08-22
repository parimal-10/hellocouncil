import type {
  AppendWorkflowEventInput,
  CreateReviewInput,
  WorkflowRunRecord,
  WorkflowStepRecord,
  WorkflowStore,
} from "@/modules/workflows/store";
import type { WorkflowAction, WorkflowRunStatus, WorkflowStepStatus } from "@/modules/workflows/types";

export class TestWorkflowStore implements WorkflowStore {
  runs = new Map<string, WorkflowRunRecord>();
  steps = new Map<string, WorkflowStepRecord>();
  events: AppendWorkflowEventInput[] = [];
  reviews: Array<CreateReviewInput & { id: string; status: string; note?: string }> = [];
  contactAttempts: Array<Record<string, unknown>> = [];

  async getRun(id: string) {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run;
  }

  async getDueSteps(now: Date) {
    return [...this.steps.values()].filter((step) => step.status === "due" && step.dueAt <= now);
  }

  async getStep(id: string) {
    const step = this.steps.get(id);
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step;
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

  async resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }) {
    const review = this.reviews.find((item) => item.id === input.reviewRequestId);
    if (!review) throw new Error(`Review not found: ${input.reviewRequestId}`);
    review.status = input.status;
    review.note = input.note;
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }) {
    this.contactAttempts.push(input);
  }

  async applyAction(action: WorkflowAction) {
    await this.appendEvent({
      workflowRunId: action.workflowRunId,
      type: `action.${action.type}`,
      summary: "Applied action in test store.",
      actorType: "voice_agent",
      payload: action,
    });
    return { ok: true, message: `Applied ${action.type}` };
  }
}
