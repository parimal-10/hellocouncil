import { routeWorkflowAction, type WorkflowActionResult } from "@/modules/workflows/action-router";
import { getWorkflowDefinition, workflowDefinitions } from "@/modules/workflows/definitions";
import { WorkflowEngine } from "@/modules/workflows/engine";
import type { WorkflowStore } from "@/modules/workflows/store";
import type { VoiceSessionPersistence } from "@/modules/voice/session-runner";
import type { ReviewBlockReason, WorkflowAction } from "@/modules/workflows/types";

export const voiceToolNames = [
  "create_update",
  "request_review",
  "mark_contact_attempt",
  "schedule_follow_up",
  "add_review_note",
] as const;

export type VoiceToolName = (typeof voiceToolNames)[number];
export type VoiceToolEventStore = Pick<VoiceSessionPersistence, "appendSessionEvent">;

export async function executeVoiceWorkflowTool(input: {
  workflowRunId: string;
  toolName: string;
  payload: unknown;
  store?: WorkflowStore;
  voiceEventStore?: VoiceToolEventStore;
  voiceSessionId?: string;
  toolCallId?: string;
}): Promise<WorkflowActionResult> {
  if (!isVoiceToolName(input.toolName)) {
    throw new Error(`Tool ${input.toolName} is not allowed for voice agents.`);
  }

  const workflowRunId = requiredString(input.workflowRunId, "workflowRunId");
  const eventContext = voiceEventContext(input);

  await appendToolEvent(eventContext, "tool_call", {
    toolName: input.toolName,
    payload: input.payload,
  });

  let result: WorkflowActionResult;
  try {
    const action = toWorkflowAction(workflowRunId, input.toolName, input.payload);
    const store = input.store ?? await defaultWorkflowStore();
    const run = await store.getRun(workflowRunId);
    if (action.type === "add_review_note") {
      const review = await store.getReview(action.reviewRequestId);
      if (review.workflowRunId !== workflowRunId) {
        throw new Error(`Review ${review.id} does not belong to workflow run ${workflowRunId}.`);
      }
    }

    const definition = getWorkflowDefinition(run.definitionId);
    const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });
    result = await routeWorkflowAction({ action, definition, engine });
  } catch (error) {
    await appendToolEvent(eventContext, "tool_result", {
      ok: false,
      message: errorMessage(error),
    });
    throw error;
  }

  await appendToolEvent(eventContext, "tool_result", result);
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
    return {
      type: "schedule_follow_up",
      workflowRunId,
      stepType: stringField(body, "stepType"),
      dueAt: dateField(body, "dueAt"),
      reason: stringField(body, "reason"),
    };
  }

  return {
    type: "add_review_note",
    reviewRequestId: stringField(body, "reviewRequestId"),
    note: stringField(body, "note"),
  };
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Tool payload must be an object.");
  }
  return payload as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string) {
  return requiredString(payload[key], key);
}

function requiredString(value: unknown, key: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
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
  throw new Error(`${key} is not a supported review reason.`);
}

function contactOutcomeField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  if (value === "reached" || value === "left_message" || value === "failed" || value === "refused") {
    return value;
  }
  throw new Error(`${key} is not a supported contact outcome.`);
}

function dateField(payload: Record<string, unknown>, key: string) {
  const value = stringField(payload, key);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${key} must be a valid date.`);
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
  type: "tool_call" | "tool_result",
  payload: Record<string, unknown>,
) {
  if (!context) return;
  await context.store.appendSessionEvent({
    voiceSessionId: context.voiceSessionId,
    type,
    toolCallId: context.toolCallId,
    payload,
    occurredAt: new Date(),
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown voice tool error.";
}
