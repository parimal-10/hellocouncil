import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { WorkflowDetailSections } from "../app/workflows/[id]/workflow-detail-sections";
import { buildWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { OutboundCallContext, PhoneCallRecord } from "@/modules/phone/types";

const now = new Date("2026-08-24T17:00:00.000Z");
const dueAt = new Date("2026-08-25T17:00:00.000Z");

const detail = {
  run: {
    id: "run-1",
    definitionId: "medical-records-follow-up",
    caseId: "case-1",
    status: "active",
    title: "Medical records follow-up",
    summary: "Provider asked us to call back.",
  },
  caseRecord: { id: "case-1", matterName: "Lee v. Metro Transit" },
  context: {
    caseId: "case-1",
    matterName: "Lee v. Metro Transit",
    clientName: "Jordan Lee",
    providerName: "Northside Imaging",
    assignedUserName: "Maya Singh",
  },
  steps: [
    {
      id: "step-1",
      workflowRunId: "run-1",
      stepType: "provider_follow_up",
      label: "Follow up with provider",
      status: "due",
      dueAt,
      attemptCount: 1,
      payload: {},
    },
  ],
  reviews: [],
  attempts: [
    {
      id: "attempt-1",
      workflowRunId: "run-1",
      workflowStepId: "step-1",
      channel: "phone",
      outcome: "reached",
      summary: "Reached the records desk.",
      attemptedAt: now,
    },
  ],
  events: [
    {
      id: "event-1",
      workflowRunId: "run-1",
      type: "phone_call.completed",
      summary: "Provider asked us to call back.",
      actorType: "worker",
      payload: {},
      occurredAt: now,
    },
  ],
};

const callContext: OutboundCallContext = {
  caseId: "case-1",
  workflowRunId: "run-1",
  definitionId: "medical-records-follow-up",
  matterName: "Lee v. Metro Transit",
  clientName: "Jordan Lee",
  clientPhone: "+13125550101",
  timeZone: "America/Chicago",
  timeZoneSource: "explicit",
  assignedUserName: "Maya Singh",
  providerName: "Northside Imaging",
  providerPhone: "+13125550199",
  runTitle: "Medical records follow-up",
  runStatus: "active",
  runSummary: "Provider asked us to call back.",
  events: [],
  attempts: [],
  reviews: [],
  priorCalls: [],
};

const phoneCall: PhoneCallRecord = {
  id: "call-1",
  caseId: "case-1",
  workflowRunId: "run-1",
  workflowStepId: "step-1",
  voiceSessionId: null,
  contactAttemptId: "attempt-1",
  twilioCallSid: "CA123",
  toNumber: "+13125550199",
  fromNumber: "+15551234567",
  timeZone: "America/Chicago",
  briefing: "briefing",
  connectionStatus: "answered",
  twilioCallStatus: "completed",
  answeredBy: "human",
  transcript: [
    { speaker: "agent", text: "When should we call you back?", occurredAt: now },
    { speaker: "client", text: "Call me in one minute.", occurredAt: now },
  ],
  structuredOutcome: {
    newInformation: ["Provider asked for a callback."],
    requestedCallbackAt: "2026-08-24T17:01:00.000Z",
    requestedCallbackLocal: "Monday, August 24, 2026 at 12:01 PM CDT",
    status: "callback requested",
    sentiment: "neutral",
    shouldContinueOutreach: true,
    recommendedFollowUpHours: null,
    urgency: "normal",
  },
  complianceFlags: [],
  createdAt: now,
  updatedAt: now,
  completedAt: now,
  orchestrationAppliedAt: now,
};

describe("WorkflowDetailSections", () => {
  it("renders the rich workflow status and call transcript for embedding in a case file", () => {
    const definition = getWorkflowDefinition("medical-records-follow-up");
    const briefing = buildWorkflowBriefing({
      run: detail.run,
      definition,
      context: detail.context,
      steps: detail.steps,
      reviews: detail.reviews,
      attempts: detail.attempts,
      events: detail.events,
      now,
    });

    render(
      <WorkflowDetailSections
        briefing={briefing}
        callContext={callContext}
        detail={detail}
        phoneCalls={[phoneCall]}
      />,
    );

    expect(screen.getByText(/Lee v\. Metro Transit is active/i)).toBeInTheDocument();
    expect(screen.getByText("Next follow-up")).toBeInTheDocument();
    expect(screen.getByText("Call me in one minute.")).toBeInTheDocument();
    expect(screen.getByText(/Outcome: callback requested/i)).toBeInTheDocument();
  });
});
