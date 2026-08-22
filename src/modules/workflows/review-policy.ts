import type { ReviewDecision, WorkflowSignal } from "./types";

const sensitiveTerms = ["settlement", "lawsuit", "sue", "legal advice", "should i sign"];
const ambiguousTerms = ["not sure", "maybe", "i guess", "unclear", "confused"];
const refusalTerms = ["refuse", "will not", "cannot release", "no authorization"];

export function evaluateHumanReviewPolicy(signal: WorkflowSignal): ReviewDecision {
  const text = signal.text.toLowerCase();

  if (!signal.hasAuthorization && signal.actorRole === "provider") {
    return {
      kind: "block",
      reason: "missing_authorization",
      severity: "high",
      recommendedAction: "Upload or verify a signed medical-records authorization.",
      summary: "Provider interaction cannot proceed without authorization.",
    };
  }

  if (sensitiveTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "sensitive_legal_advice",
      severity: "high",
      recommendedAction: "Assign a firm teammate to respond.",
      summary: "The response appears to ask for legal advice or discuss legal strategy.",
    };
  }

  if (signal.actorRole === "client" && ambiguousTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "ambiguous_client_response",
      severity: "medium",
      recommendedAction: "Review the client response and clarify the next check-in.",
      summary: "The client response is ambiguous and needs human interpretation.",
    };
  }

  if (signal.actorRole === "provider" && refusalTerms.some((term) => text.includes(term))) {
    return {
      kind: "block",
      reason: "provider_refusal",
      severity: "high",
      recommendedAction: "Have a staff member contact the provider.",
      summary: "The provider refused or could not release records.",
    };
  }

  if (signal.attemptCount >= 3) {
    return {
      kind: "block",
      reason: "failed_contact_threshold",
      severity: "medium",
      recommendedAction: "Review contact strategy before another attempt.",
      summary: "The workflow reached the failed contact attempt threshold.",
    };
  }

  return { kind: "allow" };
}
