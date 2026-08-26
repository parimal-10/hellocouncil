import { decideAttemptWindow } from "@/modules/phone/follow-up-policy";
import { workflowDefinitions } from "./definitions";
import { WorkflowEngine, type OutboundFollowUpPort } from "./engine";
import type { WorkflowStepRecord, WorkflowStore } from "./store";
import { blockStep, payloadBoolean, placeAutoDial, recoverClaimedStep } from "./transitions";

export type ExecuteStepOutcome =
  | { kind: "placed" }
  | { kind: "deferred_to_window"; dueAt: Date }
  | { kind: "blocked_for_review" }
  | { kind: "noop" };

export type ExecutionDeps = {
  store: WorkflowStore;
  outboundCaller?: OutboundFollowUpPort;
};

export async function advanceDueStep(deps: ExecutionDeps, stepId: string, now: Date): Promise<ExecuteStepOutcome> {
  const { store, outboundCaller } = deps;
  const existing = await store.getStep(stepId);
  if (existing.status !== "due" || existing.dueAt > now) return { kind: "noop" };

  // Explicitly requested follow-ups (voice agent, reviewer, case creation) honor the
  // requested instant and are never deferred to the business-hours window.
  const explicitlyRequested = payloadBoolean(existing.payload, "requestedByUser", false);
  if (!explicitlyRequested && outboundCaller && shouldAutoDial(outboundCaller, existing)) {
    const { timeZone } = await outboundCaller.evaluateWindow({
      workflowRunId: existing.workflowRunId,
      now,
    });
    const window = decideAttemptWindow({ now, timeZone });
    if (window.action === "defer_to_window") {
      await new WorkflowEngine({ store, definitions: workflowDefinitions }).applyFollowUpDecision({
        workflowRunId: existing.workflowRunId,
        stepId: existing.id,
        decision: window,
        now,
      });
      return { kind: "deferred_to_window", dueAt: window.dueAt! };
    }
  }

  const step = await store.claimDueStep(stepId, now);
  if (!step) return { kind: "noop" };

  try {
    const run = await store.getRun(step.workflowRunId);
    if (
      step.stepType === "provider_follow_up"
      && !payloadBoolean(step.payload, "hasAuthorization", true)
    ) {
      await blockStep(store, run.id, step.id, step.attemptCount, {
        kind: "block",
        reason: "missing_authorization",
        severity: "high",
        recommendedAction: "Verify authorization before contacting the provider again.",
        summary: "Provider outreach is blocked until authorization is verified.",
      });
      return { kind: "blocked_for_review" };
    }

    if (!outboundCaller) {
      throw new Error(
        "Automatic outbound calling is not configured. Due follow-ups place real Twilio calls; set AUTO_OUTBOUND_CALLS=true with a phone runtime.",
      );
    }
    if (!shouldAutoDial(outboundCaller, step)) {
      throw new Error(`Step type ${step.stepType} has no outbound calling path.`);
    }

    await placeAutoDial(store, outboundCaller, step, now);
    return { kind: "placed" };
  } catch (error) {
    await recoverClaimedStep(store, workflowDefinitions, step, error);
    throw error;
  }
}

function shouldAutoDial(outboundCaller: OutboundFollowUpPort | undefined, step: WorkflowStepRecord): boolean {
  return Boolean(outboundCaller) && (step.stepType === "client_check_in" || step.stepType === "provider_follow_up");
}
