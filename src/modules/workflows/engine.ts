import type { FollowUpDecision } from "@/modules/phone/follow-up-policy";
import { blockStep, serializeDecision } from "./transitions";
import type { WorkflowRunRecord, WorkflowStepRecord, WorkflowStore } from "./store";
import type { ReviewDecision, WorkflowAction, WorkflowDefinition } from "./types";

export type OutboundFollowUpPort = {
  evaluateWindow(input: { workflowRunId: string; now: Date }): Promise<{ timeZone: string }>;
  placeCall(input: { workflowRunId: string; stepId: string; now: Date }): Promise<{ callId: string }>;
};

export class WorkflowEngine {
  private readonly definitionsById: Map<string, WorkflowDefinition>;

  constructor(
    private readonly input: {
      store: WorkflowStore;
      definitions: readonly WorkflowDefinition[];
      outboundCaller?: OutboundFollowUpPort;
    },
  ) {
    this.definitionsById = new Map(input.definitions.map((definition) => [definition.id, definition]));
  }

  async getRun(id: string): Promise<WorkflowRunRecord> {
    return this.input.store.getRun(id);
  }

  async getStep(id: string): Promise<WorkflowStepRecord> {
    return this.input.store.getStep(id);
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
      payload: { reason: action.reason, requestedByUser: true },
    });
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.scheduled",
      summary: action.reason,
      actorType: "voice_agent",
      payload: { stepId: step.id, stepType: action.stepType, dueAt: action.dueAt.toISOString() },
    });
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
      actorType: this.actorForActionSource(action.source),
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

  async applyFollowUpDecision(input: {
    workflowRunId: string;
    stepId?: string | null;
    callId?: string | null;
    decision: FollowUpDecision;
    failedConnectCount?: number;
    now: Date;
    review?: Extract<ReviewDecision, { kind: "block" }>;
  }): Promise<void> {
    const run = await this.input.store.getRun(input.workflowRunId);
    const definition = this.definitionFor(run.definitionId);
    const step = input.stepId ? await this.input.store.getStep(input.stepId) : null;
    await this.logSchedulingDecision(input);

    if (input.decision.action === "human_review") {
      const review =
        input.review ??
        ({
          kind: "block" as const,
          reason: "failed_contact_threshold" as const,
          severity: "medium" as const,
          recommendedAction: "Review contact strategy before another attempt.",
          summary: input.decision.reason,
        } satisfies Extract<ReviewDecision, { kind: "block" }>);
      if (step) {
        await this.input.store.updateStepPayload(step.id, this.decisionPayload(input));
        await blockStep(this.input.store, run.id, step.id, step.attemptCount, review);
      } else {
        await this.input.store.updateRunStatus(run.id, "waiting_for_human", review.summary);
        await this.input.store.createReview({ workflowRunId: run.id, decision: review });
      }
      return;
    }

    if (input.decision.action === "complete") {
      if (step && (step.status === "running" || step.status === "due")) {
        await this.input.store.updateStepPayload(step.id, this.decisionPayload(input));
        await this.input.store.updateStepStatus(step.id, "completed", step.attemptCount);
      }
      await this.input.store.updateRunStatus(run.id, "active", input.decision.reason);
      return;
    }

    if (input.decision.action === "retry" || input.decision.action === "defer_to_window") {
      if (!input.decision.dueAt) return;
      if (step) {
        await this.input.store.updateStepPayload(step.id, this.decisionPayload(input));
        await this.input.store.rescheduleStep(step.id, input.decision.dueAt);
      } else {
        await this.createFollowUpStep({
          runId: run.id,
          definition,
          completedStepType: definition.stepTemplates[0]?.type ?? "client_check_in",
          dueAt: input.decision.dueAt,
          now: input.now,
          payload: this.decisionPayload(input),
        });
      }
      return;
    }

    if (input.decision.action === "schedule") {
      if (!input.decision.dueAt) return;
      if (step && (step.status === "running" || step.status === "due")) {
        await this.input.store.updateStepPayload(step.id, this.decisionPayload(input));
        await this.input.store.updateStepStatus(step.id, "completed", step.attemptCount);
        await this.input.store.appendEvent({
          workflowRunId: run.id,
          type: "step.completed",
          summary: input.decision.reason,
          actorType: "worker",
          payload: { stepId: step.id, callId: input.callId },
        });
      }
      await this.createFollowUpStep({
        runId: run.id,
        definition,
        completedStepType: step?.stepType ?? definition.stepTemplates[0]?.type ?? "client_check_in",
        dueAt: input.decision.dueAt,
        now: input.now,
        payload: { failedConnectCount: 0, schedulingDecision: serializeDecision(input.decision) },
      });
    }
  }

  private async createFollowUpStep(input: {
    runId: string;
    definition: WorkflowDefinition;
    completedStepType: string;
    dueAt: Date;
    now: Date;
    payload: Record<string, unknown>;
  }) {
    const template = input.definition.scheduleNextStep({
      completedStepType: input.completedStepType,
      now: input.now,
      signal: {
        text: "",
        channel: "phone",
        attemptCount: 0,
        hasAuthorization: true,
        actorRole: "client",
      },
    });
    if (!template) {
      await this.input.store.updateRunStatus(input.runId, "completed", "Workflow completed.");
      return;
    }
    const scheduledStep = await this.input.store.createStep({
      workflowRunId: input.runId,
      stepType: template.type,
      label: template.label,
      dueAt: input.dueAt,
      payload: input.payload,
    });
    await this.input.store.appendEvent({
      workflowRunId: input.runId,
      type: "step.scheduled",
      summary: `${template.label} scheduled.`,
      actorType: "worker",
      payload: { stepId: scheduledStep.id, stepType: template.type, dueAt: input.dueAt.toISOString() },
    });
  }

  private async logSchedulingDecision(input: {
    workflowRunId: string;
    stepId?: string | null;
    callId?: string | null;
    decision: FollowUpDecision;
  }) {
    await this.input.store.appendEvent({
      workflowRunId: input.workflowRunId,
      type: "scheduling.decision",
      summary: input.decision.reason,
      actorType: "worker",
      payload: {
        action: input.decision.action,
        reason: input.decision.reason,
        policyId: input.decision.policyId,
        dueAt: input.decision.dueAt?.toISOString() ?? null,
        metadata: input.decision.metadata,
        callId: input.callId ?? null,
        stepId: input.stepId ?? null,
      },
    });
  }

  private decisionPayload(input: { decision: FollowUpDecision; failedConnectCount?: number; callId?: string | null }) {
    const payload: Record<string, unknown> = {
      awaitingCallCompletion: false,
      schedulingDecision: serializeDecision(input.decision),
    };
    if (typeof input.failedConnectCount === "number") payload.failedConnectCount = input.failedConnectCount;
    if (input.callId) payload.outboundCallId = input.callId;
    return payload;
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
}
