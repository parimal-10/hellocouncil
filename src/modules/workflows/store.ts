import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, type DbClient } from "@/db/client";
import {
  contactAttempts,
  humanReviewRequests,
  workflowEvents,
  workflowRuns,
  workflowSteps,
} from "@/db/schema";
import type { ReviewDecision, WorkflowAction, WorkflowDefinitionId, WorkflowRunStatus, WorkflowStepStatus } from "./types";

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
  queueJobScheduledAt?: Date | null;
  queueSchedulingClaimUntil?: Date | null;
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

export type WorkflowStore = {
  getRun(id: string): Promise<WorkflowRunRecord>;
  getDueSteps(now: Date): Promise<WorkflowStepRecord[]>;
  getStep(id: string): Promise<WorkflowStepRecord>;
  claimDueStep(id: string, now: Date): Promise<WorkflowStepRecord | null>;
  claimDueStepForScheduling(id: string, now: Date, claimUntil: Date): Promise<boolean>;
  markDueStepScheduled(id: string, scheduledAt: Date): Promise<void>;
  releaseDueStepSchedulingClaim(id: string, claimUntil: Date): Promise<void>;
  updateRunStatus(id: string, status: WorkflowRunStatus, summary?: string): Promise<void>;
  updateStepStatus(id: string, status: WorkflowStepStatus, attemptCount?: number): Promise<void>;
  createStep(input: { workflowRunId: string; stepType: string; label: string; dueAt: Date; payload?: Record<string, unknown> }): Promise<WorkflowStepRecord>;
  appendEvent(input: AppendWorkflowEventInput): Promise<void>;
  createReview(input: CreateReviewInput): Promise<string>;
  resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }): Promise<void>;
  createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }): Promise<void>;
  applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }>;
};

export class DrizzleWorkflowStore implements WorkflowStore {
  constructor(private readonly client: DbClient = db) {}

  async getRun(id: string): Promise<WorkflowRunRecord> {
    const [run] = await this.client.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    if (!run) throw new Error(`Workflow run not found: ${id}`);
    return run as WorkflowRunRecord;
  }

  async getDueSteps(now: Date): Promise<WorkflowStepRecord[]> {
    const rows = await this.client
      .select()
      .from(workflowSteps)
      .where(
        and(
          eq(workflowSteps.status, "due"),
          lte(workflowSteps.dueAt, now),
          isNull(workflowSteps.queueJobScheduledAt),
          or(isNull(workflowSteps.queueSchedulingClaimUntil), lte(workflowSteps.queueSchedulingClaimUntil, now)),
        ),
      )
      .orderBy(asc(workflowSteps.dueAt));
    return rows as WorkflowStepRecord[];
  }

  async getStep(id: string): Promise<WorkflowStepRecord> {
    const [step] = await this.client.select().from(workflowSteps).where(eq(workflowSteps.id, id));
    if (!step) throw new Error(`Workflow step not found: ${id}`);
    return step as WorkflowStepRecord;
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

  async claimDueStepForScheduling(id: string, now: Date, claimUntil: Date): Promise<boolean> {
    const [step] = await this.client
      .update(workflowSteps)
      .set({ queueSchedulingClaimUntil: claimUntil, updatedAt: new Date() })
      .where(
        and(
          eq(workflowSteps.id, id),
          eq(workflowSteps.status, "due"),
          lte(workflowSteps.dueAt, now),
          isNull(workflowSteps.queueJobScheduledAt),
          or(isNull(workflowSteps.queueSchedulingClaimUntil), lte(workflowSteps.queueSchedulingClaimUntil, now)),
        ),
      )
      .returning({ id: workflowSteps.id });
    return Boolean(step);
  }

  async markDueStepScheduled(id: string, scheduledAt: Date): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({
        queueJobScheduledAt: scheduledAt,
        queueSchedulingClaimUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(workflowSteps.id, id), eq(workflowSteps.status, "due")));
  }

  async releaseDueStepSchedulingClaim(id: string, claimUntil: Date): Promise<void> {
    await this.client
      .update(workflowSteps)
      .set({ queueSchedulingClaimUntil: null, updatedAt: new Date() })
      .where(
        and(
          eq(workflowSteps.id, id),
          eq(workflowSteps.status, "due"),
          isNull(workflowSteps.queueJobScheduledAt),
          eq(workflowSteps.queueSchedulingClaimUntil, claimUntil),
        ),
      );
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

  async resolveReview(input: { reviewRequestId: string; status: "approved" | "edited" | "rejected" | "resolved"; note: string }): Promise<void> {
    await this.client
      .update(humanReviewRequests)
      .set({ status: input.status, reviewerNote: input.note, updatedAt: new Date() })
      .where(eq(humanReviewRequests.id, input.reviewRequestId));
  }

  async createContactAttempt(input: { workflowRunId: string; workflowStepId?: string; channel: string; outcome: string; summary: string; syntheticResponse?: string }): Promise<void> {
    await this.client.insert(contactAttempts).values(input);
  }

  async applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }> {
    await this.appendEvent({
      workflowRunId: action.workflowRunId,
      type: `action.${action.type}`,
      summary: "Voice action routed into workflow engine.",
      actorType: "voice_agent",
      payload: action,
    });
    return { ok: true, message: `Applied ${action.type}` };
  }

  async recentEvents(limit = 20) {
    return this.client.select().from(workflowEvents).orderBy(desc(workflowEvents.occurredAt)).limit(limit);
  }
}
