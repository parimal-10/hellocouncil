import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowEngine, OutboundFollowUpPort } from "@/modules/workflows/engine";
import { evaluateHumanReviewPolicy } from "@/modules/workflows/review-policy";
import { FOLLOW_UP_POLICY, decideNextFollowUp, type FollowUpDecision } from "./follow-up-policy";
import { isTerminalConnectionStatus } from "./status";
import type { PhoneCallRecord, PhoneCallStore } from "./types";

export type { OutboundFollowUpPort, FollowUpDecision };

export async function applyOutboundCallFollowUp(input: {
  call: PhoneCallRecord;
  now: Date;
  engine: WorkflowEngine;
  phoneStore: Pick<PhoneCallStore, "claimOrchestration">;
}): Promise<FollowUpDecision | null> {
  if (!isTerminalConnectionStatus(input.call.connectionStatus)) return null;
  if (!(await input.phoneStore.claimOrchestration(input.call.id, input.now))) return null;

  const run = await input.engine.getRun(input.call.workflowRunId);
  const step = input.call.workflowStepId ? await input.engine.getStep(input.call.workflowStepId) : null;
  const definition = getWorkflowDefinition(run.definitionId);
  const template =
    definition.stepTemplates.find((item) => item.type === step?.stepType) ?? definition.stepTemplates[0];

  if (input.call.connectionStatus === "answered") {
    const hitl = evaluateHumanReviewPolicy({
      text: conversationText(input.call),
      channel: "phone",
      attemptCount: 0,
      hasAuthorization: true,
      actorRole: "client",
    });
    if (hitl.kind === "block") {
      const decision: FollowUpDecision = {
        action: "human_review",
        dueAt: null,
        reason: hitl.summary,
        policyId: FOLLOW_UP_POLICY.id,
        metadata: { rule: "hitl", reviewReason: hitl.reason, timeZone: input.call.timeZone },
      };
      await input.engine.applyFollowUpDecision({
        workflowRunId: input.call.workflowRunId,
        stepId: step?.id,
        callId: input.call.id,
        decision,
        now: input.now,
        review: hitl,
      });
      return decision;
    }
  }

  const failedConnectCount = nextFailedConnectCount(step?.payload, input.call.connectionStatus);
  const decision = decideNextFollowUp({
    connectionStatus: input.call.connectionStatus,
    now: input.now,
    timeZone: input.call.timeZone,
    failedConnectCount,
    structuredOutcome: input.call.structuredOutcome,
    defaultFollowUpHours: template?.defaultDueInHours,
  });

  await input.engine.applyFollowUpDecision({
    workflowRunId: input.call.workflowRunId,
    stepId: step?.id,
    callId: input.call.id,
    decision,
    failedConnectCount,
    now: input.now,
  });
  return decision;
}

function nextFailedConnectCount(payload: unknown, status: PhoneCallRecord["connectionStatus"]): number {
  const prior =
    typeof payload === "object" && payload !== null && typeof (payload as { failedConnectCount?: unknown }).failedConnectCount === "number"
      ? (payload as { failedConnectCount: number }).failedConnectCount
      : 0;
  if (status === "no-answer" || status === "voicemail" || status === "busy" || status === "failed") {
    return prior + 1;
  }
  return 0;
}

function conversationText(call: PhoneCallRecord): string {
  const outcome = call.structuredOutcome;
  return [
    outcome?.status ?? "",
    ...(outcome?.newInformation ?? []),
    ...call.transcript.map((turn) => turn.text),
  ].join(" ");
}
