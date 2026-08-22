import { evaluateHumanReviewPolicy } from "./review-policy";
import type { WorkflowDefinition, WorkflowStepTemplate } from "./types";

const providerFollowUpStep: WorkflowStepTemplate = {
  type: "provider_follow_up",
  label: "Follow up with provider",
  defaultDueInHours: 24,
  retryLimit: 3,
};

const clientCheckInStep: WorkflowStepTemplate = {
  type: "client_check_in",
  label: "Check in with client",
  defaultDueInHours: 72,
  retryLimit: 2,
};

export const medicalRecordsFollowUpDefinition: WorkflowDefinition = {
  id: "medical-records-follow-up",
  label: "Medical records follow-up",
  description: "Follow up with a medical provider for records status updates.",
  requiredContext: ["case", "client", "provider", "assigned_user"],
  stepTemplates: [providerFollowUpStep],
  allowedActions: ["create_update", "request_review", "mark_contact_attempt", "schedule_follow_up", "resolve_blocked_step"],
  reviewPolicy: evaluateHumanReviewPolicy,
  scheduleNextStep: ({ signal }) => {
    if (signal.text.toLowerCase().includes("records are ready")) {
      return null;
    }
    return providerFollowUpStep;
  },
};

export const clientCheckInDefinition: WorkflowDefinition = {
  id: "client-check-in",
  label: "Client check-in",
  description: "Periodically check in with a client and surface meaningful updates.",
  requiredContext: ["case", "client", "assigned_user"],
  stepTemplates: [clientCheckInStep],
  allowedActions: ["create_update", "request_review", "mark_contact_attempt", "schedule_follow_up", "resolve_blocked_step"],
  reviewPolicy: evaluateHumanReviewPolicy,
  scheduleNextStep: () => clientCheckInStep,
};

export const workflowDefinitions = [
  medicalRecordsFollowUpDefinition,
  clientCheckInDefinition,
] as const;

export function getWorkflowDefinition(id: WorkflowDefinition["id"]): WorkflowDefinition {
  const definition = workflowDefinitions.find((item) => item.id === id);
  if (!definition) {
    throw new Error(`Unknown workflow definition: ${id}`);
  }
  return definition;
}
