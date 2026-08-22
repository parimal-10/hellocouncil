import { getSyntheticResponse } from "./synthetic-responses";
import type { WorkflowStore } from "./store";
import type { WorkflowAction, WorkflowDefinition, WorkflowSignal } from "./types";

export type WorkflowStepScheduler = {
  scheduleDueStep(input: { stepId: string; runAt: Date }): Promise<string>;
};

export class WorkflowEngine {
  private readonly definitionsById: Map<string, WorkflowDefinition>;

  constructor(
    private readonly input: {
      store: WorkflowStore;
      definitions: readonly WorkflowDefinition[];
      syntheticResponses?: Record<string, string>;
      scheduler?: WorkflowStepScheduler;
    },
  ) {
    this.definitionsById = new Map(input.definitions.map((definition) => [definition.id, definition]));
  }

  async advanceDueStep(stepId: string, now: Date): Promise<void> {
    const step = await this.input.store.claimDueStep(stepId, now);
    if (!step) return;

    const run = await this.input.store.getRun(step.workflowRunId);
    const definition = this.definitionFor(run.definitionId);

    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.running",
      summary: `${step.label} started.`,
      actorType: "worker",
      payload: { stepId: step.id, stepType: step.stepType },
    });

    const syntheticResponse = getSyntheticResponse(step.stepType, this.input.syntheticResponses);
    const outcome = this.outcomeForResponse(syntheticResponse);
    const signal = this.signalForStep(step.stepType, syntheticResponse, this.failedAttemptCount(step.payload, outcome), step.payload);
    const decision = definition.reviewPolicy(signal);

    if (decision.kind === "block" && decision.reason === "missing_authorization") {
      await this.blockStep(run.id, step.id, step.attemptCount, decision);
      return;
    }

    await this.input.store.createContactAttempt({
      workflowRunId: run.id,
      workflowStepId: step.id,
      channel: signal.channel,
      outcome,
      summary: `Synthetic ${signal.channel} attempt: ${syntheticResponse}`,
      syntheticResponse,
    });

    if (decision.kind === "block") {
      await this.blockStep(run.id, step.id, step.attemptCount, decision);
      return;
    }

    await this.input.store.updateStepStatus(step.id, "completed", step.attemptCount);
    await this.input.store.updateRunStatus(run.id, "active", syntheticResponse);
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.completed",
      summary: syntheticResponse,
      actorType: "worker",
      payload: { stepId: step.id, stepType: step.stepType },
    });

    const nextStep = definition.scheduleNextStep({
      completedStepType: step.stepType,
      now,
      signal,
    });

    if (nextStep) {
      const dueAt = new Date(now.getTime() + nextStep.defaultDueInHours * 60 * 60 * 1000);
      const scheduledStep = await this.input.store.createStep({
        workflowRunId: run.id,
        stepType: nextStep.type,
        label: nextStep.label,
        dueAt,
        payload: { failedAttemptCount: signal.attemptCount },
      });
      try {
        const jobId = await this.input.scheduler?.scheduleDueStep({ stepId: scheduledStep.id, runAt: dueAt });
        if (!jobId) throw new Error("Due-step scheduler did not return a job id.");
        await this.input.store.markDueStepScheduled(scheduledStep.id, now);
      } catch (error) {
        await this.markScheduleFailed(run.id, scheduledStep.id, error);
        return;
      }
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "step.scheduled",
        summary: `${nextStep.label} scheduled.`,
        actorType: "worker",
        payload: { stepType: nextStep.type, dueAt: dueAt.toISOString() },
      });
    } else {
      await this.input.store.updateRunStatus(run.id, "completed", "Workflow completed.");
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "workflow.completed",
        summary: "Workflow completed.",
        actorType: "worker",
      });
    }
  }

  async applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }> {
    if (action.type === "resolve_blocked_step") {
      const review = await this.input.store.getReview(action.reviewRequestId);
      if (review.status !== "open" && review.status !== "assigned") {
        throw new Error(`Review ${action.reviewRequestId} is not open or assigned.`);
      }

      if (action.resolution === "assigned") {
        if (!action.assignedUserId) throw new Error("An assigned user is required when assigning a review.");
        await this.input.store.resolveReview({
          reviewRequestId: review.id,
          status: "assigned",
          note: action.note,
          assignedUserId: action.assignedUserId,
        });
        await this.input.store.appendEvent({
          workflowRunId: review.workflowRunId,
          type: "review.assigned",
          summary: action.note,
          actorType: "reviewer",
          payload: action,
        });
        return { ok: true, message: "Review assigned." };
      }

      if (!review.workflowStepId) throw new Error(`Review ${action.reviewRequestId} is not associated with a workflow step.`);
      await this.input.store.resolveReview({
        reviewRequestId: review.id,
        status: action.resolution,
        note: action.note,
        assignedUserId: action.assignedUserId,
      });
      await this.input.store.rescheduleStep(review.workflowStepId, new Date());
      await this.input.store.updateRunStatus(review.workflowRunId, "active", action.note);
      await this.input.store.appendEvent({
        workflowRunId: review.workflowRunId,
        type: "review.resolved",
        summary: action.note,
        actorType: "reviewer",
        payload: action,
      });
      return { ok: true, message: "Review resolved and workflow reactivated." };
    }

    return this.input.store.applyAction(action);
  }

  private definitionFor(id: string) {
    const definition = this.definitionsById.get(id);
    if (!definition) throw new Error(`Unknown workflow definition: ${id}`);
    return definition;
  }

  private async blockStep(
    workflowRunId: string,
    workflowStepId: string,
    attemptCount: number,
    decision: Extract<ReturnType<WorkflowDefinition["reviewPolicy"]>, { kind: "block" }>,
  ) {
    await this.input.store.updateStepStatus(workflowStepId, "waiting_for_human", attemptCount);
    await this.input.store.updateRunStatus(workflowRunId, "waiting_for_human", decision.summary);
    await this.input.store.createReview({ workflowRunId, workflowStepId, decision });
    await this.input.store.appendEvent({
      workflowRunId,
      type: "review.created",
      summary: decision.summary,
      actorType: "worker",
      payload: decision,
    });
  }

  private async markScheduleFailed(workflowRunId: string, workflowStepId: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown scheduler error.";
    const summary = "Workflow step scheduling will be retried.";
    await this.input.store.appendEvent({
      workflowRunId,
      type: "step.schedule_failed",
      summary,
      actorType: "worker",
      payload: { stepId: workflowStepId, error: message },
    });
  }

  private signalForStep(stepType: string, text: string, failedAttemptCount: number, payload: unknown): WorkflowSignal {
    const actorRole = stepType === "client_check_in" ? "client" : "provider";
    return {
      text,
      channel: "phone",
      attemptCount: failedAttemptCount,
      hasAuthorization: this.hasAuthorization(stepType, payload),
      actorRole,
    };
  }

  private outcomeForResponse(text: string) {
    const normalized = text.toLowerCase();
    if (normalized.includes("cannot")) return "refused";
    if (normalized.includes("no response") || normalized.includes("unable to reach") || normalized.includes("unreachable")) return "failed";
    return "reached";
  }

  private failedAttemptCount(payload: unknown, outcome: string) {
    const priorCount = this.payloadNumber(payload, "failedAttemptCount");
    return priorCount + (outcome === "failed" ? 1 : 0);
  }

  private hasAuthorization(stepType: string, payload: unknown) {
    return stepType === "provider_follow_up" ? this.payloadBoolean(payload, "hasAuthorization", true) : true;
  }

  private payloadNumber(payload: unknown, key: string) {
    if (!this.isPayload(payload)) return 0;
    const value = payload[key];
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
  }

  private payloadBoolean(payload: unknown, key: string, fallback: boolean) {
    if (!this.isPayload(payload)) return fallback;
    const value = payload[key];
    return typeof value === "boolean" ? value : fallback;
  }

  private isPayload(payload: unknown): payload is Record<string, unknown> {
    return typeof payload === "object" && payload !== null;
  }
}
