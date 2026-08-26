import { routeWorkflowAction, type WorkflowActionResult } from "@/modules/workflows/action-router";
import { loadOutboundCallContext } from "@/modules/phone/store";
import { resolveClientTimeExpression } from "@/modules/time/timezone";
import { loadWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition, workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";
import type { VoiceSessionPersistence } from "@/modules/voice/store";
import type { ReviewBlockReason, WorkflowAction, WorkflowDefinition } from "@/modules/workflows/types";

export const voiceToolNames = [
  "get_workflow_status",
  "create_update",
  "request_review",
  "mark_contact_attempt",
  "schedule_follow_up",
  "run_follow_up_now",
  "add_review_note",
] as const;

export type VoiceToolName = (typeof voiceToolNames)[number];
export type VoiceToolEventStore = Pick<VoiceSessionPersistence, "appendSessionEvent"> & {
  claimToolCall(input: {
    voiceSessionId: string;
    toolCallId: string;
    toolName: string;
    payload: unknown;
    occurredAt: Date;
  }): Promise<boolean>;
  getToolCallResult(
    voiceSessionId: string,
    toolCallId: string,
  ): Promise<Record<string, unknown> | null>;
};

class VoiceToolPublicError extends Error {}

const safeInfrastructureMessage = "The voice workflow tool could not be completed.";

export type SignalRunImpl = (options: {
  workflowRunId: string;
  signal: string;
  args: unknown[];
}) => Promise<void>;

export type LoadWorkflowTimeZoneImpl = (workflowRunId: string) => Promise<string>;

async function defaultSignalRun(options: { workflowRunId: string; signal: string; args: unknown[] }) {
  const { signalRun } = await import("@/temporal/start-run");
  await signalRun(options as Parameters<typeof signalRun>[0]);
}

async function defaultLoadWorkflowTimeZone(workflowRunId: string) {
  const context = await loadOutboundCallContext(workflowRunId);
  return context.timeZone;
}

async function requestImmediateFollowUp(input: {
  workflowRunId: string;
  now: Date;
  store: WorkflowStore;
  signalRun: SignalRunImpl;
}): Promise<WorkflowActionResult> {
  const run = await input.store.getRun(input.workflowRunId);
  if (run.status === "waiting_for_human") {
    return {
      ok: false,
      message: "This workflow is waiting for human review. Outreach is paused until a reviewer resumes it.",
    };
  }
  if (run.status !== "active") {
    return {
      ok: false,
      message: `This workflow is ${run.status}, so a follow-up cannot be run now.`,
    };
  }

  const definition = getWorkflowDefinition(run.definitionId);
  const steps = await input.store.listSteps(input.workflowRunId);
  const step = steps
    .filter((item) => item.status === "due")
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())[0];

  if (!step) {
    const template = definition.stepTemplates[0];
    if (!template) {
      return { ok: false, message: "This workflow has no follow-up step type to run." };
    }
    await input.store.createStep({
      workflowRunId: input.workflowRunId,
      stepType: template.type,
      label: template.label,
      dueAt: input.now,
      payload: { reason: "Immediate follow-up requested.", requestedByUser: true },
    });
  } else if (step.dueAt > input.now) {
    await input.store.rescheduleStep(step.id, input.now);
    await input.store.updateStepPayload(step.id, { requestedByUser: true });
  }

  await input.signalRun({ workflowRunId: input.workflowRunId, signal: "runFollowUpNow", args: [] });
  return { ok: true, message: "Follow-up requested. The workflow will place the call shortly." };
}

export async function executeVoiceWorkflowTool(input: {
  workflowRunId: string;
  toolName: string;
  payload: unknown;
  store?: WorkflowStore;
  voiceEventStore?: VoiceToolEventStore;
  voiceSessionId?: string;
  toolCallId?: string;
  loadBriefing?: typeof loadWorkflowBriefing;
  signalRunImpl?: SignalRunImpl;
  loadWorkflowTimeZone?: LoadWorkflowTimeZoneImpl;
  now?: Date;
}): Promise<WorkflowActionResult> {
  const eventContext = voiceEventContext(input);
  if (eventContext) {
    let claimed: boolean;
    try {
      claimed = await eventContext.store.claimToolCall({
        voiceSessionId: eventContext.voiceSessionId,
        toolCallId: eventContext.toolCallId,
        toolName: input.toolName,
        payload: input.payload,
        occurredAt: new Date(),
      });
    } catch (error) {
      throw safeInfrastructureError(error);
    }
    if (!claimed) {
      let persistedResult: Record<string, unknown> | null;
      try {
        persistedResult = await eventContext.store.getToolCallResult(
          eventContext.voiceSessionId,
          eventContext.toolCallId,
        );
      } catch (error) {
        throw safeInfrastructureError(error);
      }
      return workflowActionResult(persistedResult) ?? {
        ok: false,
        message: "This voice tool call is already being processed.",
      };
    }
  }

  let result: WorkflowActionResult;
  try {
    if (!isVoiceToolName(input.toolName)) {
      throw new VoiceToolPublicError(
        `Tool ${input.toolName} is not allowed for voice agents.`,
      );
    }

    const workflowRunId = requiredString(input.workflowRunId, "workflowRunId");
    const store = input.store ?? await defaultWorkflowStore();

    if (input.toolName === "get_workflow_status") {
      const briefing = await (input.loadBriefing ?? loadWorkflowBriefing)(workflowRunId, input.now);
      result = { ok: true, message: briefing.spokenSummary };
    } else if (input.toolName === "run_follow_up_now") {
      result = await requestImmediateFollowUp({
        workflowRunId,
        now: input.now ?? new Date(),
        store,
        signalRun: input.signalRunImpl ?? defaultSignalRun,
      });
    } else {
      const action = toWorkflowAction(workflowRunId, input.toolName, input.payload);
      const run = await store.getRun(workflowRunId);
      if (action.type === "add_review_note") {
        const review = await store.getReview(action.reviewRequestId);
        if (review.workflowRunId !== workflowRunId) {
          throw new VoiceToolPublicError(
            `Review ${review.id} does not belong to workflow run ${workflowRunId}.`,
          );
        }
        if (review.status !== "open" && review.status !== "assigned") {
          throw new VoiceToolPublicError(`Review ${review.id} is not open or assigned.`);
        }
      }

      const definition = getWorkflowDefinition(run.definitionId);
      if (
        action.type === "schedule_follow_up"
        && !definition.allowedActions.includes("schedule_follow_up")
      ) {
        throw new VoiceToolPublicError(
          `Action schedule_follow_up is not allowed for workflow ${definition.id}.`,
        );
      }
      const resolvedAction = action.type === "schedule_follow_up"
        ? await resolveScheduleFollowUp({
            action,
            definition,
            payload: input.payload,
            now: input.now ?? new Date(),
            loadWorkflowTimeZone: input.loadWorkflowTimeZone ?? defaultLoadWorkflowTimeZone,
          })
        : action;
      if (
        resolvedAction.type === "schedule_follow_up"
        && !definition.stepTemplates.some((step) => step.type === resolvedAction.stepType)
      ) {
        throw new VoiceToolPublicError(
          `Step type ${resolvedAction.stepType} is not defined for workflow ${definition.id}. Valid step types: ${definition.stepTemplates.map((step) => step.type).join(", ")}.`,
        );
      }
      const engine = new WorkflowEngine({
        store,
        definitions: workflowDefinitions,
      });
      if (resolvedAction.type === "schedule_follow_up") {
        result = await engine.applyAction(resolvedAction);
        await (input.signalRunImpl ?? defaultSignalRun)({
          workflowRunId,
          signal: "scheduleFollowUp",
          args: [
            {
              stepType: resolvedAction.stepType,
              dueAt: resolvedAction.dueAt.toISOString(),
              reason: resolvedAction.reason,
            },
          ],
        });
      } else {
        result = await routeWorkflowAction({ action: resolvedAction, definition, engine });
      }
    }
  } catch (error) {
    const safeError = safeVoiceToolError(error);
    try {
      await appendToolEvent(eventContext, {
        ok: false,
        message: safeError.message,
      });
    } catch (persistenceError) {
      throw new AggregateError(
        [safeError, persistenceError],
        "Voice tool execution failed and its safe result could not be persisted.",
      );
    }
    throw safeError;
  }

  try {
    await appendToolEvent(eventContext, result);
  } catch (persistenceError) {
    throw new AggregateError(
      [persistenceError],
      "Voice workflow action completed but its result could not be persisted.",
    );
  }

  return result;
}

async function defaultWorkflowStore() {
  const { DrizzleWorkflowStore } = await import("@/modules/workflows/store");
  return new DrizzleWorkflowStore();
}

function isVoiceToolName(value: string): value is VoiceToolName {
  return (voiceToolNames as readonly string[]).includes(value);
}

function toWorkflowAction(workflowRunId: string, toolName: VoiceToolName, payload: unknown): WorkflowAction {
  const body = objectPayload(payload);

  if (toolName === "create_update") {
    return {
      type: "create_update",
      workflowRunId,
      summary: stringField(body, "summary"),
      source: "voice_session",
    };
  }

  if (toolName === "request_review") {
    return {
      type: "request_review",
      workflowRunId,
      reason: reviewReasonField(body, "reason"),
      summary: stringField(body, "summary"),
    };
  }

  if (toolName === "mark_contact_attempt") {
    return {
      type: "mark_contact_attempt",
      workflowRunId,
      channel: "voice_session",
      outcome: contactOutcomeField(body, "outcome"),
      summary: stringField(body, "summary"),
    };
  }

  if (toolName === "schedule_follow_up") {
    if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== "") {
      dateField(body, "dueAt");
    }
    if (body.dueInMinutes !== undefined) {
      numberField(body, "dueInMinutes");
    }
    if (body.dueInHours !== undefined) {
      numberField(body, "dueInHours");
    }
    if (body.localTimeExpression !== undefined) {
      optionalString(body, "localTimeExpression");
    }
    return {
      type: "schedule_follow_up",
      workflowRunId,
      stepType: optionalString(body, "stepType") ?? "",
      dueAt: body.dueAt ? dateField(body, "dueAt") : new Date(0),
      reason: stringField(body, "reason"),
    };
  }

  return {
    type: "add_review_note",
    reviewRequestId: stringField(body, "reviewRequestId"),
    note: stringField(body, "note"),
    source: "voice_session",
  };
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new VoiceToolPublicError("Tool payload must be an object.");
  }
  return payload as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string) {
  return requiredString(payload[key], key);
}

function optionalString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, key);
}

function requiredString(value: unknown, key: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new VoiceToolPublicError(`${key} is required.`);
  }
  return value.trim();
}

function numberField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new VoiceToolPublicError(`${key} must be a number.`);
  }
  return parsed;
}

async function resolveScheduleFollowUp(input: {
  action: Extract<WorkflowAction, { type: "schedule_follow_up" }>;
  definition: WorkflowDefinition;
  payload: unknown;
  now: Date;
  loadWorkflowTimeZone: LoadWorkflowTimeZoneImpl;
}): Promise<Extract<WorkflowAction, { type: "schedule_follow_up" }>> {
  const body = objectPayload(input.payload);
  const template = input.action.stepType
    ? input.definition.stepTemplates.find((step) => step.type === input.action.stepType)
    : input.definition.stepTemplates[0];
  if (!template) {
    throw new VoiceToolPublicError(
      `Step type ${input.action.stepType} is not defined for workflow ${input.definition.id}. Valid step types: ${input.definition.stepTemplates.map((step) => step.type).join(", ")}.`,
    );
  }
  const dueAt = await resolveScheduleDueAt({
    action: input.action,
    payload: body,
    now: input.now,
    defaultDueInHours: template.defaultDueInHours,
    loadWorkflowTimeZone: input.loadWorkflowTimeZone,
  });
  return { ...input.action, stepType: template.type, dueAt };
}

async function resolveScheduleDueAt(input: {
  action: Extract<WorkflowAction, { type: "schedule_follow_up" }>;
  payload: Record<string, unknown>;
  now: Date;
  defaultDueInHours: number;
  loadWorkflowTimeZone: LoadWorkflowTimeZoneImpl;
}) {
  if (input.action.dueAt.getTime() !== 0) return input.action.dueAt;
  if (input.payload.dueInMinutes !== undefined) {
    return new Date(input.now.getTime() + numberField(input.payload, "dueInMinutes") * 60 * 1000);
  }
  if (input.payload.dueInHours !== undefined) {
    return new Date(input.now.getTime() + numberField(input.payload, "dueInHours") * 60 * 60 * 1000);
  }
  const localTimeExpression = optionalString(input.payload, "localTimeExpression");
  if (localTimeExpression) {
    const timeZone = await input.loadWorkflowTimeZone(input.action.workflowRunId);
    const resolved = resolveClientTimeExpression(localTimeExpression, timeZone, input.now);
    if (!resolved.ok) throw new VoiceToolPublicError(resolved.error);
    return resolved.utc;
  }
  return new Date(input.now.getTime() + input.defaultDueInHours * 60 * 60 * 1000);
}

function reviewReasonField(payload: Record<string, unknown>, key: string): ReviewBlockReason {
  const value = stringField(payload, key);
  const supportedReasons: readonly ReviewBlockReason[] = [
    "missing_authorization",
    "ambiguous_client_response",
    "provider_refusal",
    "sensitive_legal_advice",
    "failed_contact_threshold",
  ];
  if (supportedReasons.includes(value as ReviewBlockReason)) {
    return value as ReviewBlockReason;
  }
  throw new VoiceToolPublicError(`${key} is not a supported review reason.`);
}

function contactOutcomeField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  if (value === "reached" || value === "left_message" || value === "failed" || value === "refused") {
    return value;
  }
  throw new VoiceToolPublicError(`${key} is not a supported contact outcome.`);
}

function dateField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new VoiceToolPublicError(`${key} must be a valid date.`);
  }
  return date;
}

function voiceEventContext(input: {
  voiceEventStore?: VoiceToolEventStore;
  voiceSessionId?: string;
  toolCallId?: string;
}) {
  const { voiceEventStore, voiceSessionId, toolCallId } = input;
  const hasNoContext = voiceEventStore === undefined && voiceSessionId === undefined && toolCallId === undefined;
  if (hasNoContext) return undefined;

  if (voiceEventStore === undefined || voiceSessionId === undefined || toolCallId === undefined) {
    throw new Error("voiceEventStore, voiceSessionId, and toolCallId must be provided together.");
  }

  return {
    store: voiceEventStore,
    voiceSessionId: requiredString(voiceSessionId, "voiceSessionId"),
    toolCallId: requiredString(toolCallId, "toolCallId"),
  };
}

async function appendToolEvent(
  context: ReturnType<typeof voiceEventContext>,
  payload: Record<string, unknown>,
) {
  if (!context) return;
  await context.store.appendSessionEvent({
    voiceSessionId: context.voiceSessionId,
    type: "tool_result",
    toolCallId: context.toolCallId,
    payload,
    occurredAt: new Date(),
  });
}

function safeVoiceToolError(error: unknown) {
  return error instanceof VoiceToolPublicError ? error : safeInfrastructureError(error);
}

function safeInfrastructureError(error: unknown) {
  return new Error(safeInfrastructureMessage, { cause: error });
}

function workflowActionResult(payload: Record<string, unknown> | null) {
  if (
    payload &&
    typeof payload.ok === "boolean" &&
    typeof payload.message === "string"
  ) {
    return { ok: payload.ok, message: payload.message };
  }
  return null;
}
