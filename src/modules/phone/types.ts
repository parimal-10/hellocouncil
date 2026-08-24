import type { TimeZoneSource } from "@/modules/time/timezone";

export type ConnectionStatus =
  | "initiated"
  | "ringing"
  | "answered"
  | "no-answer"
  | "busy"
  | "failed"
  | "voicemail";

export type PhoneTranscriptTurn = {
  speaker: "agent" | "client";
  text: string;
  occurredAt: Date;
};

export type StructuredCallOutcome = {
  newInformation: string[];
  requestedCallbackAt: string | null;
  requestedCallbackLocal: string | null;
  status: string;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  shouldContinueOutreach: boolean;
  recommendedFollowUpHours: number | null;
  urgency: "high" | "normal" | "low";
};

export type ComplianceFlag = {
  code: "quiet_hours" | "consent_unconfirmed" | "do_not_call" | "disclosure_required";
  detail: string;
};

export type ComplianceResult = {
  blocked: false;
  flags: ComplianceFlag[];
};

export type PhoneCallRecord = {
  id: string;
  caseId: string;
  workflowRunId: string;
  workflowStepId: string | null;
  voiceSessionId: string | null;
  contactAttemptId: string | null;
  twilioCallSid: string | null;
  toNumber: string;
  fromNumber: string;
  timeZone: string;
  briefing: string;
  connectionStatus: ConnectionStatus;
  twilioCallStatus: string | null;
  answeredBy: string | null;
  transcript: PhoneTranscriptTurn[];
  structuredOutcome: StructuredCallOutcome | null;
  complianceFlags: ComplianceFlag[];
  orchestrationAppliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type CallHistoryItem = {
  type: string;
  summary: string;
  occurredAt: Date;
};

export type OutboundCallContext = {
  caseId: string;
  workflowRunId: string;
  matterName: string;
  clientName: string;
  clientPhone: string;
  timeZone: string;
  timeZoneSource: TimeZoneSource;
  assignedUserName: string;
  providerName?: string;
  runTitle: string;
  runStatus: string;
  runSummary: string;
  events: CallHistoryItem[];
  attempts: Array<{ channel: string; outcome: string; summary: string; attemptedAt: Date }>;
  reviews: Array<{ reason: string; summary: string; status: string; reviewerNote?: string | null }>;
  priorCalls: Array<{
    connectionStatus: string;
    structuredOutcome: StructuredCallOutcome | null;
    transcript: PhoneTranscriptTurn[];
  }>;
};

export type PhoneCallStore = {
  createCall(input: Omit<PhoneCallRecord, "id" | "createdAt" | "updatedAt">): Promise<PhoneCallRecord>;
  getCall(id: string): Promise<PhoneCallRecord | null>;
  updateCall(id: string, patch: Partial<PhoneCallRecord>): Promise<PhoneCallRecord>;
  appendTranscript(id: string, turn: PhoneTranscriptTurn): Promise<PhoneCallRecord>;
  recordContactAttempt(input: {
    workflowRunId: string;
    workflowStepId?: string;
    channel: string;
    outcome: string;
    summary: string;
  }): Promise<string>;
  claimOrchestration(id: string, now: Date): Promise<boolean>;
  appendWorkflowEvent(input: {
    workflowRunId: string;
    type: string;
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  updateRunSummary(workflowRunId: string, summary: string): Promise<void>;
  listCallsForRun(workflowRunId: string): Promise<PhoneCallRecord[]>;
};

export type TwilioVoiceClient = {
  createCall(input: {
    to: string;
    from: string;
    url: string;
    statusCallback: string;
    statusCallbackEvent: string[];
    machineDetection: "Enable";
  }): Promise<{ sid: string; status: string }>;
};

export type PhoneCallConfig = {
  fromNumber: string;
  publicBaseUrl: string;
};
