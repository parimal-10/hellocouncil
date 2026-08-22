import { getSyntheticResponse } from "./synthetic-responses";
import type { WorkflowStepRecord, WorkflowStore } from "./store";
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

    try {
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
    } catch (error) {
      await this.recoverClaimedStep(step, error);
      throw error;
    }
  }

  async applyAction(action: WorkflowAction): Promise<{ ok: boolean; message: string }> {
    if (action.type === "resolve_blocked_step") return this.resolveBlockedStep(action);
    if (action.type === "add_review_note") return this.addReviewNote(action);

    const run = await this.input.store.getRun(action.workflowRunId);

    if (action.type === "create_update") {
      await this.input.store.updateRunStatus(run.id, run.status, action.summary);
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "action.create_update",
        summary: action.summary,
        actorType: this.actorForActionSource(action.source),
        payload: action,
      });
      return { ok: true, message: "Workflow update recorded." };
    }

    if (action.type === "request_review") {
      const decision = this.reviewDecisionForAction(action.reason, action.summary);
      await this.input.store.updateRunStatus(run.id, "waiting_for_human", action.summary);
      await this.input.store.createReview({ workflowRunId: run.id, decision });
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "review.created",
        summary: action.summary,
        actorType: "voice_agent",
        payload: action,
      });
      return { ok: true, message: "Human review requested." };
    }

    if (action.type === "mark_contact_attempt") {
      await this.input.store.createContactAttempt({
        workflowRunId: run.id,
        channel: action.channel,
        outcome: action.outcome,
        summary: action.summary,
      });
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "action.mark_contact_attempt",
        summary: action.summary,
        actorType: "voice_agent",
        payload: action,
      });
      return { ok: true, message: "Contact attempt recorded." };
    }

    const definition = this.definitionFor(run.definitionId);
    const template = definition.stepTemplates.find((item) => item.type === action.stepType);
    if (!template) throw new Error(`Step type ${action.stepType} is not defined for workflow ${definition.id}.`);
    const step = await this.input.store.createStep({
      workflowRunId: run.id,
      stepType: action.stepType,
      label: template.label,
      dueAt: action.dueAt,
      payload: { reason: action.reason },
    });
    let schedulerError: unknown;
    if (this.input.scheduler) {
      try {
        const jobId = await this.input.scheduler.scheduleDueStep({ stepId: step.id, runAt: action.dueAt });
        if (!jobId) throw new Error("Due-step scheduler did not return a job id.");
        await this.input.store.markDueStepScheduled(step.id, new Date());
      } catch (error) {
        schedulerError = error;
      }
    }
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.scheduled",
      summary: action.reason,
      actorType: "voice_agent",
      payload: { stepId: step.id, stepType: action.stepType, dueAt: action.dueAt.toISOString() },
    });
    if (schedulerError) {
      await this.markScheduleFailed(run.id, step.id, schedulerError);
      return { ok: true, message: "Follow-up created; queue scheduling will be retried." };
    }
    return { ok: true, message: "Follow-up scheduled." };
  }

  private async resolveBlockedStep(action: Extract<WorkflowAction, { type: "resolve_blocked_step" }>) {
    const review = await this.reviewableRequest(action.reviewRequestId);

    if (action.resolution === "assigned" && !action.assignedUserId) {
      throw new Error("An assigned user is required when assigning a review.");
    }
    if (action.assignedUserId && !(await this.input.store.isAssignableFirmUser(action.assignedUserId))) {
      throw new Error(`Assigned user ${action.assignedUserId} must be a firm user.`);
    }

    await this.input.store.resolveReview({
      reviewRequestId: review.id,
      status: action.resolution,
      note: action.note,
      assignedUserId: action.assignedUserId,
    });

    if (action.resolution === "assigned") {
      await this.input.store.appendEvent({
        workflowRunId: review.workflowRunId,
        type: "review.assigned",
        summary: action.note,
        actorType: "reviewer",
        payload: action,
      });
      return { ok: true, message: "Review assigned." };
    }

    if (action.resolution === "rejected") {
      if (review.workflowStepId) await this.input.store.updateStepStatus(review.workflowStepId, "skipped");
      await this.input.store.updateRunStatus(review.workflowRunId, "failed", action.note);
      await this.input.store.appendEvent({
        workflowRunId: review.workflowRunId,
        type: "review.rejected",
        summary: action.note,
        actorType: "reviewer",
        payload: action,
      });
      return { ok: true, message: "Automation rejected and workflow stopped." };
    }

    if (review.workflowStepId) {
      const payloadPatch: Record<string, unknown> = { humanReviewResolution: action.resolution };
      if (action.resolution === "edited") payloadPatch.humanReviewNote = action.note;
      if (review.reason === "missing_authorization" && (action.resolution === "approved" || action.resolution === "resolved")) {
        payloadPatch.hasAuthorization = true;
      }
      await this.input.store.updateStepPayload(review.workflowStepId, payloadPatch);
      await this.input.store.rescheduleStep(review.workflowStepId, new Date());
    }
    await this.input.store.updateRunStatus(review.workflowRunId, "active", action.note);
    await this.input.store.appendEvent({
      workflowRunId: review.workflowRunId,
      type: `review.${action.resolution}`,
      summary: action.note,
      actorType: "reviewer",
      payload: action,
    });
    return { ok: true, message: "Review closed and workflow reactivated." };
  }

  private async addReviewNote(action: Extract<WorkflowAction, { type: "add_review_note" }>) {
    const review = await this.reviewableRequest(action.reviewRequestId);
    await this.input.store.appendEvent({
      workflowRunId: review.workflowRunId,
      type: "review.note_added",
      summary: action.note,
      actorType: "reviewer",
      payload: { reviewRequestId: review.id },
    });
    return { ok: true, message: "Review note added." };
  }

  private async reviewableRequest(reviewRequestId: string) {
    const review = await this.input.store.getReview(reviewRequestId);
    if (review.status !== "open" && review.status !== "assigned") {
      throw new Error(`Review ${reviewRequestId} is not open or assigned.`);
    }
    return review;
  }

  private definitionFor(id: string) {
    const definition = this.definitionsById.get(id);
    if (!definition) throw new Error(`Unknown workflow definition: ${id}`);
    return definition;
  }

  private async recoverClaimedStep(step: WorkflowStepRecord, error: unknown) {
    const retryLimit = this.retryLimitFor(step.stepType);
    const retryable = step.attemptCount <= retryLimit;
    const transitioned = await this.input.store.transitionClaimedStepAfterFailure(
      step.id,
      step.attemptCount,
      retryable ? "due" : "failed",
    );
    if (!transitioned) return;

    const message = this.errorMessage(error);
    if (!retryable) {
      await this.input.store.updateRunStatus(step.workflowRunId, "failed", message);
    }
    await this.input.store.appendEvent({
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

  private retryLimitFor(stepType: string) {
    for (const definition of this.input.definitions) {
      const template = definition.stepTemplates.find((item) => item.type === stepType);
      if (template) return template.retryLimit;
    }
    return 0;
  }

  private reviewDecisionForAction(reason: Extract<WorkflowAction, { type: "request_review" }>["reason"], summary: string) {
    const highSeverityReasons = ["missing_authorization", "provider_refusal", "sensitive_legal_advice"];
    return {
      kind: "block" as const,
      reason,
      severity: highSeverityReasons.includes(reason) ? "high" as const : "medium" as const,
      recommendedAction: "Review the request and decide how the workflow should proceed.",
      summary,
    };
  }

  private actorForActionSource(source: Extract<WorkflowAction, { type: "create_update" }>["source"]) {
    if (source === "worker") return "worker" as const;
    if (source === "reviewer") return "reviewer" as const;
    return "voice_agent" as const;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unknown workflow processing error.";
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
    const message = this.errorMessage(error);
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
