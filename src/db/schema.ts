import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  email: text("email"),
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

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: text("definition_id").notNull(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  status: text("status").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  syntheticResponse: text("synthetic_response"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSessions = pgTable("voice_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  workflowRunId: uuid("workflow_run_id").notNull().references(() => workflowRuns.id),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const voiceSessionEvents = pgTable("voice_session_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  voiceSessionId: uuid("voice_session_id").notNull().references(() => voiceSessions.id),
  type: text("type").notNull(),
  speaker: text("speaker"),
  text: text("text"),
  toolCallId: text("tool_call_id"),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});
