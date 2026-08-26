import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  email: text("email"),
  timeZone: text("time_zone"),
  timeZoneSource: text("time_zone_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  matterName: text("matter_name").notNull(),
  status: text("status").notNull(),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => people.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseParticipants = pgTable("case_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  personId: uuid("person_id").references(() => people.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  role: text("role").notNull(),
});

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: text("definition_id").notNull(),
    caseId: uuid("case_id").notNull().references(() => cases.id),
    status: text("status").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    temporalWorkflowId: text("temporal_workflow_id"),
  },
  (table) => ({
    temporalIdIdx: index("workflow_runs_temporal_workflow_id_idx").on(table.temporalWorkflowId),
  }),
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    stepType: text("step_type").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    dueIdx: index("workflow_steps_due_idx").on(table.status, table.dueAt),
  }),
);

export const workflowEvents = pgTable(
  "workflow_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    actorType: text("actor_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("workflow_events_run_idx").on(table.workflowRunId, table.occurredAt),
  }),
);

export const humanReviewRequests = pgTable("human_review_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  assignedUserId: uuid("assigned_user_id").references(() => people.id),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contactAttempts = pgTable("contact_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
  channel: text("channel").notNull(),
  outcome: text("outcome").notNull(),
  summary: text("summary").notNull(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    launchId: text("launch_id"),
    roomName: text("room_name"),
    participantIdentity: text("participant_identity"),
    providerSessionId: text("provider_session_id"),
    endedReason: text("ended_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    launchIdUnique: uniqueIndex("voice_sessions_launch_id_unique").on(table.launchId),
    roomNameUnique: uniqueIndex("voice_sessions_room_name_unique").on(table.roomName),
    participantIdentityUnique: uniqueIndex(
      "voice_sessions_participant_identity_unique",
    ).on(table.participantIdentity),
  }),
);

export const voiceSessionEvents = pgTable(
  "voice_session_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
    type: text("type").notNull(),
    speaker: text("speaker"),
    text: text("text"),
    toolCallId: text("tool_call_id"),
    payload: jsonb("payload").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    toolCallUnique: uniqueIndex("voice_session_events_tool_call_unique").on(
      table.voiceSessionId,
      table.toolCallId,
      table.type,
    ),
  }),
);

export const phoneCalls = pgTable(
  "phone_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").notNull().references(() => cases.id),
    workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id),
    voiceSessionId: uuid("voice_session_id").references(() => voiceSessions.id),
    contactAttemptId: uuid("contact_attempt_id").references(() => contactAttempts.id),
    twilioCallSid: text("twilio_call_sid"),
    toNumber: text("to_number").notNull(),
    fromNumber: text("from_number").notNull(),
    timeZone: text("time_zone").notNull(),
    briefing: text("briefing").notNull().default(""),
    connectionStatus: text("connection_status").notNull().default("initiated"),
    twilioCallStatus: text("twilio_call_status"),
    answeredBy: text("answered_by"),
    transcript: jsonb("transcript").notNull().default([]),
    structuredOutcome: jsonb("structured_outcome"),
    complianceFlags: jsonb("compliance_flags").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    orchestrationAppliedAt: timestamp("orchestration_applied_at", { withTimezone: true }),
  },
  (table) => ({
    callSidUnique: uniqueIndex("phone_calls_twilio_call_sid_unique").on(table.twilioCallSid),
    caseIdx: index("phone_calls_case_idx").on(table.caseId, table.createdAt),
  }),
);
