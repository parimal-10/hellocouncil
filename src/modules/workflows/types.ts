export type WorkflowDefinitionId = "medical-records-follow-up" | "client-check-in";

export type WorkflowRunStatus = "active" | "waiting_for_human" | "completed" | "failed" | "cancelled";
export type WorkflowStepStatus = "pending" | "due" | "running" | "waiting_for_human" | "completed" | "failed" | "skipped";
export type ReviewRequestStatus = "open" | "approved" | "edited" | "rejected" | "assigned" | "resolved";

export type WorkflowActionType =
  | "create_update"
  | "request_review"
  | "mark_contact_attempt"
  | "schedule_follow_up"
  | "resolve_blocked_step"
  | "add_review_note";

export type ContactChannel = "phone" | "sms" | "email" | "portal" | "voice_session";

export type LegalContext = {
  caseId: string;
  caseName: string;
  clientName: string;
  providerName?: string;
  assignedUserName: string;
};

export type WorkflowStepTemplate = {
  type: string;
  label: string;
  defaultDueInHours: number;
  retryLimit: number;
};

export type WorkflowSignal = {
  text: string;
  channel: ContactChannel;
  attemptCount: number;
  hasAuthorization: boolean;
  actorRole: "client" | "provider" | "firm_user" | "voice_agent";
};

export type ReviewBlockReason =
  | "missing_authorization"
  | "ambiguous_client_response"
  | "provider_refusal"
  | "sensitive_legal_advice"
  | "failed_contact_threshold";

export type ReviewDecision =
  | { kind: "allow" }
  | {
      kind: "block";
      reason: ReviewBlockReason;
      severity: "medium" | "high";
      recommendedAction: string;
      summary: string;
    };

export type ScheduleContext = {
  completedStepType: string;
  now: Date;
  signal: WorkflowSignal;
};

export type WorkflowDefinition = {
  id: WorkflowDefinitionId;
  label: string;
  description: string;
  requiredContext: Array<"case" | "client" | "provider" | "assigned_user">;
  stepTemplates: WorkflowStepTemplate[];
  allowedActions: WorkflowActionType[];
  reviewPolicy: (signal: WorkflowSignal) => ReviewDecision;
  scheduleNextStep: (context: ScheduleContext) => WorkflowStepTemplate | null;
};

export type WorkflowAction =
  | {
      type: "create_update";
      workflowRunId: string;
      summary: string;
      source: "voice_session" | "worker" | "reviewer";
    }
  | {
      type: "request_review";
      workflowRunId: string;
      reason: ReviewBlockReason;
      summary: string;
    }
  | {
      type: "mark_contact_attempt";
      workflowRunId: string;
      channel: ContactChannel;
      outcome: "reached" | "left_message" | "failed" | "refused";
      summary: string;
    }
  | {
      type: "schedule_follow_up";
      workflowRunId: string;
      dueAt: Date;
      stepType: string;
      reason: string;
    }
  | {
      type: "resolve_blocked_step";
      reviewRequestId: string;
      resolution: "approved" | "edited" | "rejected" | "resolved" | "assigned";
      note: string;
      assignedUserId?: string;
    }
  | {
      type: "add_review_note";
      reviewRequestId: string;
      note: string;
    };
