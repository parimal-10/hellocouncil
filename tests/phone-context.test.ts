import { describe, expect, it } from "vitest";
import { assembleOutboundCallContext } from "@/modules/phone/context";

describe("outbound call context", () => {
  it("uses the client's stored IANA zone and keeps the call context", () => {
    const context = assembleOutboundCallContext({
      run: {
        id: "run-1",
        caseId: "case-1",
        definitionId: "medical-records-follow-up",
        title: "Records follow-up",
        status: "active",
        summary: "Waiting on records.",
      },
      caseRecord: { id: "case-1", matterName: "Lee v. Metro Transit" },
      client: {
        name: "Jordan Lee",
        phone: "+13125550101",
        timeZone: "America/Chicago",
        timeZoneSource: "explicit",
      },
      assignedUserName: "Maya Singh",
      providerName: "Northside Imaging",
      providerPhone: "555-0199",
      events: [
        { type: "workflow.started", summary: "Started.", occurredAt: new Date("2026-08-20T12:00:00.000Z") },
        { type: "contact.attempted", summary: "Left a message.", occurredAt: new Date("2026-08-21T16:00:00.000Z") },
      ],
      attempts: [
        { channel: "phone", outcome: "left_message", summary: "Left a message.", attemptedAt: new Date("2026-08-21T16:00:00.000Z") },
      ],
      reviews: [{ reason: "provider_refusal", summary: "Need auth.", status: "open", reviewerNote: null }],
      priorCalls: [],
    });

    expect(context.timeZone).toBe("America/Chicago");
    expect(context.timeZoneSource).toBe("explicit");
    expect(context.clientPhone).toBe("+13125550101");
    expect(context.definitionId).toBe("medical-records-follow-up");
    expect(context.providerPhone).toBe("555-0199");
    expect(context.events).toHaveLength(2);
    expect(context.attempts).toHaveLength(1);
    expect(context.reviews).toHaveLength(1);
  });

  it("infers timezone from the phone number when none is stored", () => {
    const context = assembleOutboundCallContext({
      run: { id: "run-1", caseId: "case-1", definitionId: "client-check-in", title: "Check-in", status: "active", summary: "" },
      caseRecord: { id: "case-1", matterName: "Park v. Oak Logistics" },
      client: { name: "Elena Park", phone: "305-555-0102", timeZone: null, timeZoneSource: null },
      assignedUserName: "Maya Singh",
      events: [],
      attempts: [],
      reviews: [],
      priorCalls: [],
    });
    expect(context.timeZone).toBe("America/New_York");
    expect(context.timeZoneSource).toBe("phone_area_code");
  });

  it("bounds noisy source history before building call prompts", () => {
    const context = assembleOutboundCallContext({
      run: {
        id: "run-1",
        caseId: "case-1",
        definitionId: "medical-records-follow-up",
        title: "Records follow-up",
        status: "active",
        summary: "Waiting on records.",
      },
      caseRecord: { id: "case-1", matterName: "Lee v. Metro Transit" },
      client: {
        name: "Jordan Lee",
        phone: "+13125550101",
        timeZone: "America/Chicago",
        timeZoneSource: "explicit",
      },
      assignedUserName: "Maya Singh",
      providerName: "Northside Imaging",
      providerPhone: "555-0199",
      events: Array.from({ length: 12 }, (_, index) => ({
        type: "workflow.event",
        summary: `Event ${index + 1}`,
        occurredAt: new Date(Date.UTC(2026, 7, 20 + index, 12)),
      })),
      attempts: Array.from({ length: 10 }, (_, index) => ({
        channel: "phone",
        outcome: "failed",
        summary: `Attempt ${index + 1}`,
        attemptedAt: new Date(Date.UTC(2026, 7, 20 + index, 13)),
      })),
      reviews: Array.from({ length: 7 }, (_, index) => ({
        createdAt: new Date(Date.UTC(2026, 7, 20 + index, 11)),
        reason: "provider_refusal",
        summary: `Review ${index + 1}`,
        status: index === 6 ? "open" : "resolved",
        reviewerNote: null,
      })),
      priorCalls: Array.from({ length: 7 }, (_, index) => ({
        id: `call-${index + 1}`,
        caseId: "case-1",
        workflowRunId: "run-1",
        workflowStepId: "step-1",
        voiceSessionId: null,
        contactAttemptId: null,
        twilioCallSid: null,
        toNumber: "+13125550199",
        fromNumber: "+15551234567",
        timeZone: "America/Chicago",
        briefing: "briefing",
        connectionStatus: "answered",
        twilioCallStatus: "completed",
        answeredBy: null,
        transcript: [],
        structuredOutcome: null,
        complianceFlags: [],
        orchestrationAppliedAt: null,
        createdAt: new Date(Date.UTC(2026, 7, 20 + index, 14)),
        updatedAt: new Date(Date.UTC(2026, 7, 20 + index, 14)),
        completedAt: new Date(Date.UTC(2026, 7, 20 + index, 14)),
      })),
    });

    expect(context.events).toHaveLength(8);
    expect(context.events[0]?.summary).toBe("Event 5");
    expect(context.attempts).toHaveLength(5);
    expect(context.attempts[0]?.summary).toBe("Attempt 6");
    expect(context.reviews).toHaveLength(5);
    expect(context.reviews[0]?.summary).toBe("Review 3");
    expect(context.priorCalls).toHaveLength(5);
    expect(context.priorCalls[0]?.createdAt?.toISOString()).toBe("2026-08-22T14:00:00.000Z");
  });
});
