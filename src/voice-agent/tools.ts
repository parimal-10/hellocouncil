import { routeWorkflowAction, type WorkflowActionResult } from "@/modules/workflows/action-router";
import { loadWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition, workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine, type OutboundFollowUpPort } from "@/modules/workflows/engine";
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

export async function executeVoiceWorkflowTool(input: {
  workflowRunId: string;
  toolName: string;
  payload: unknown;
  store?: WorkflowStore;
  voiceEventStore?: VoiceToolEventStore;
  voiceSessionId?: string;
  toolCallId?: string;
  loadBriefing?: typeof loadWorkflowBriefing;
  outboundCaller?: OutboundFollowUpPort;
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
      const engine = new WorkflowEngine({
        store,
        definitions: workflowDefinitions,
        outboundCaller: input.outboundCaller ?? (await resolveOutboundCaller()),
      });
      result = await engine.runFollowUpNow(workflowRunId, input.now ?? new Date());
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
      const resolvedAction = action.type === "schedule_follow_up"
        ? resolveScheduleFollowUp(action, definition, input.payload, input.now ?? new Date())
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
        outboundCaller: input.outboundCaller ?? (await resolveOutboundCaller()),
      });
      result = await routeWorkflowAction({ action: resolvedAction, definition, engine });
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

async function resolveOutboundCaller(): Promise<OutboundFollowUpPort | undefined> {
  const [{ isAutomaticOutboundCallingEnabled }, { createWorkerOutboundDialer }] = await Promise.all([
    import("@/modules/phone/auto-dial"),
    import("@/modules/phone/worker-dialer"),
  ]);
  if (!isAutomaticOutboundCallingEnabled()) return undefined;
  try {
    return createWorkerOutboundDialer();
  } catch {
    return undefined;
  }
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
    if (body.dueInHours !== undefined) {
      numberField(body, "dueInHours");
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

function resolveScheduleFollowUp(
  action: Extract<WorkflowAction, { type: "schedule_follow_up" }>,
  definition: WorkflowDefinition,
  payload: unknown,
  now: Date,
): Extract<WorkflowAction, { type: "schedule_follow_up" }> {
  const body = objectPayload(payload);
  const template = action.stepType
    ? definition.stepTemplates.find((step) => step.type === action.stepType)
    : definition.stepTemplates[0];
  if (!template) {
    throw new VoiceToolPublicError(
      `Step type ${action.stepType} is not defined for workflow ${definition.id}. Valid step types: ${definition.stepTemplates.map((step) => step.type).join(", ")}.`,
    );
  }
  const dueAt = action.dueAt.getTime() !== 0
    ? action.dueAt
    : body.dueInHours !== undefined
      ? new Date(now.getTime() + numberField(body, "dueInHours") * 60 * 60 * 1000)
      : new Date(now.getTime() + template.defaultDueInHours * 60 * 60 * 1000);
  return { ...action, stepType: template.type, dueAt };
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
