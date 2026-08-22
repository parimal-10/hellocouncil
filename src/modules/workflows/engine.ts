import { getSyntheticResponse } from "./synthetic-responses";
import type { WorkflowStore } from "./store";
import type { WorkflowAction, WorkflowDefinition, WorkflowSignal } from "./types";

export class WorkflowEngine {
  private readonly definitionsById: Map<string, WorkflowDefinition>;

  constructor(
    private readonly input: {
      store: WorkflowStore;
      definitions: readonly WorkflowDefinition[];
      syntheticResponses?: Record<string, string>;
    },
  ) {
    this.definitionsById = new Map(input.definitions.map((definition) => [definition.id, definition]));
  }

  async advanceDueStep(stepId: string, now: Date): Promise<void> {
    const step = await this.input.store.getStep(stepId);
    const run = await this.input.store.getRun(step.workflowRunId);
    const definition = this.definitionFor(run.definitionId);

    await this.input.store.updateStepStatus(step.id, "running", step.attemptCount + 1);
    await this.input.store.appendEvent({
      workflowRunId: run.id,
      type: "step.running",
      summary: `${step.label} started.`,
      actorType: "worker",
      payload: { stepId: step.id, stepType: step.stepType },
    });

    const syntheticResponse = getSyntheticResponse(step.stepType, this.input.syntheticResponses);
    const signal = this.signalForStep(step.stepType, syntheticResponse, step.attemptCount + 1);

    await this.input.store.createContactAttempt({
      workflowRunId: run.id,
      workflowStepId: step.id,
      channel: signal.channel,
      outcome: signal.text.toLowerCase().includes("cannot") ? "refused" : "reached",
      summary: `Synthetic ${signal.channel} attempt: ${syntheticResponse}`,
      syntheticResponse,
    });

    const decision = definition.reviewPolicy(signal);

    if (decision.kind === "block") {
      await this.input.store.updateStepStatus(step.id, "waiting_for_human", step.attemptCount + 1);
      await this.input.store.updateRunStatus(run.id, "waiting_for_human", decision.summary);
      await this.input.store.createReview({ workflowRunId: run.id, workflowStepId: step.id, decision });
      await this.input.store.appendEvent({
        workflowRunId: run.id,
        type: "review.created",
        summary: decision.summary,
        actorType: "worker",
        payload: decision,
      });
      return;
    }

    await this.input.store.updateStepStatus(step.id, "completed", step.attemptCount + 1);
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
      await this.input.store.createStep({
        workflowRunId: run.id,
        stepType: nextStep.type,
        label: nextStep.label,
        dueAt,
        payload: {},
      });
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
      await this.input.store.resolveReview({
        reviewRequestId: action.reviewRequestId,
        status: action.resolution,
        note: action.note,
      });
      await this.input.store.updateRunStatus(action.workflowRunId, "active", action.note);
      await this.input.store.appendEvent({
        workflowRunId: action.workflowRunId,
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

  private signalForStep(stepType: string, text: string, attemptCount: number): WorkflowSignal {
    const actorRole = stepType === "client_check_in" ? "client" : "provider";
    return {
      text,
      channel: "phone",
      attemptCount,
      hasAuthorization: true,
      actorRole,
    };
  }
}
