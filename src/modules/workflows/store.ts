import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import {
  contactAttempts,
  humanReviewRequests,
  people,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import type { ReviewDecision, ReviewRequestStatus, WorkflowDefinitionId, WorkflowRunStatus, WorkflowStepStatus } from "./types";

export type WorkflowRunRecord = {
  id: string;
  definitionId: WorkflowDefinitionId;
  caseId: string;
  status: WorkflowRunStatus;
  title: string;
  summary: string;
};

export type WorkflowStepRecord = {
  id: string;
  workflowRunId: string;
  stepType: string;
  label: string;
  status: WorkflowStepStatus;
  dueAt: Date;
  attemptCount: number;
  payload: unknown;
};

export type AppendWorkflowEventInput = {
  workflowRunId: string;
  type: string;
  summary: string;
  actorType: "worker" | "voice_agent" | "reviewer" | "system";
  payload?: Record<string, unknown>;
};

export type CreateReviewInput = {
  workflowRunId: string;
  workflowStepId?: string;
  decision: Extract<ReviewDecision, { kind: "block" }>;
};

export type ReviewRequestRecord = {
  id: string;
  workflowRunId: string;
  workflowStepId: string | null;
  status: ReviewRequestStatus;
  assignedUserId: string | null;
  reason: string;
};

export type WorkflowStore = {
  getRun(id: string): Promise<WorkflowRunRecord>;
  listSteps(workflowRunId: string): Promise<WorkflowStepRecord[]>;
  getStep(id: string): Promise<WorkflowStepRecord>;
  getReview(id: string): Promise<ReviewRequestRecord>;
  isAssignableFirmUser(id: string): Promise<boolean>;
  claimDueStep(id: string, now: Date): Promise<WorkflowStepRecord | null>;
  updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string): Promise<void>;
  updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number): Promise<void>;
  updateStepPayload(id: string, patch: Record<string, unknown>): Promise<void>;
  transitionClaimedStepAfterFailure(id: string, attemptCount: number, status: "due" | "failed"): Promise<boolean>;
  rescheduleStep(id: string, dueAt: Date): Promise<void>;
  createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }): Promise<WorkflowStepRecord>;
  appendEvent(input: AppendWorkflowEventInput): Promise<void>;
  createReview(input: CreateReviewInput): Promise<string>;
  resolveReview(input: {
    reviewRequestId: string;
    status: "approved" | "edited" | "rejected" | "resolved" | "assigned";
    note: string;
    assignedUserId?: string;
  }): Promise<void>;
  createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string }): Promise<void>;
};

export class DrizzleWorkflowStore implements WorkflowStore {
  constructor(private readonly client: DbClient = db) {}

  async getRun(id: string): Promise<WorkflowRunRecord> {
    const [run] = await this.client.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run as WorkflowRunRecord;
  }

  async listSteps(workflowRunId: string): Promise<WorkflowStepRecord[]> {
    const rows = await this.client
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowRunId, workflowRunId))
      .orderBy(asc(workflowSteps.dueAt));
    return rows as WorkflowStepRecord[];
  }

  async getStep(id: string): Promise<WorkflowStepRecord> {
    const [step] = await this.client.select().from(workflowSteps).where(eq(workflowSteps.id, id));
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step as WorkflowStepRecord;
  }

  async getReview(id: string): Promise<ReviewRequestRecord> {
    const [review] = await this.client.select().from(humanReviewRequests).where(eq(humanReviewRequests.id, id));
    if (!review) throw new Error(`Review not found: ${id}`);
    return review as ReviewRequestRecord;
  }

  async isAssignableFirmUser(id: string): Promise<boolean> {
    const [person] = await this.client
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, id), eq(people.role, "firm_user")));
    return Boolean(person);
  }

  async claimDueStep(id: string, now: Date): Promise<WorkflowStepRecord | null> {
    const [step] = await this.client
      .update(workflowSteps)
      .set({
        status: "running",
        attemptCount: sql`${workflowSteps.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowSteps.id, id), eq(workflowSteps.status, "due"), lte(workflowSteps.dueAt, now)))
      .returning();
    return (step as WorkflowStepRecord | undefined) ?? null;
  }

  async updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string): Promise<void> {
    await this.client
      .update(workflowRuns)
      .set({ status, summary, updatedAt: new Date() })
      .where(eq(workflowRuns.id, id));
  }

  async updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({ status, attemptCount, updatedAt: new Date() })
      .where(eq(workflowSteps.id, id));
  }

  async updateStepPayload(id: string, patch: Record<string, unknown>): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({
        payload: sql`${workflowSteps.payload} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(workflowSteps.id, id));
  }

  async transitionClaimedStepAfterFailure(id: string, attemptCount: number, status: "due" | "failed"): Promise<boolean> {
    const [step] = await this.client
      .update(workflowSteps)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workflowSteps.id, id),
          eq(workflowSteps.status, "running"),
          eq(workflowSteps.attemptCount, attemptCount),
        ),
      )
      .returning({ id: workflowSteps.id });
    return Boolean(step);
  }

  async rescheduleStep(id: string, dueAt: Date): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({
        status: "due",
        dueAt,
        updatedAt: new Date(),
      })
      .where(eq(workflowSteps.id, id));
  }

  async createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }): Promise<WorkflowStepRecord> {
    const [step] = await this.client
      .insert(workflowSteps)
      .values({
        workflowRunId: input.workflowRunId,
        stepType: input.stepType,
        label: input.label,
        status: "due",
        dueAt: input.dueAt,
        payload: input.payload ?? {},
      })
      .returning();
    return step as WorkflowStepRecord;
  }

  async appendEvent(input: AppendWorkflowEventInput): Promise<void> {
    await this.client.insert(workflowEvents).values({
      workflowRunId: input.workflowRunId,
      type: input.type,
      summary: input.summary,
      actorType: input.actorType,
      payload: input.payload ?? {},
    });
  }

  async createReview(input: CreateReviewInput): Promise<string> {
    const [review] = await this.client
      .insert(humanReviewRequests)
      .values({
        workflowRunId: input.workflowRunId,
        workflowStepId: input.workflowStepId,
        status: "open",
        reason: input.decision.reason,
        severity: input.decision.severity,
        summary: input.decision.summary,
        recommendedAction: input.decision.recommendedAction,
      })
      .returning({ id: humanReviewRequests.id });
    return review.id;
  }

  async resolveReview(input: {
    reviewRequestId: string;
    status: "approved" | "edited" | "rejected" | "resolved" | "assigned";
    note: string;
    assignedUserId?: string;
  }): Promise<void> {
    const [review] = await this.client
      .update(humanReviewRequests)
      .set({
        status: input.status,
        reviewerNote: input.note,
        assignedUserId: input.assignedUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(humanReviewRequests.id, input.reviewRequestId), inArray(humanReviewRequests.status, ["open", "assigned"])))
      .returning({ id: humanReviewRequests.id });
    if (!review) throw new Error(`Review ${input.reviewRequestId} is not open or assigned.`);
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string }): Promise<void> {
    await this.client.insert(contactAttempts).values(input);
  }

  async recentEvents(limit = 20) {
    return this.client.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(limit);
  }
}
