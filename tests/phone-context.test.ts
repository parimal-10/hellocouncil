import { describe, expect, it } from "vitest";
import { assembleOutboundCallContext } from "@/modules/phone/context";

describe("outbound call context", () => {
  it("uses the client's stored IANA zone and keeps the full history", () => {
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
});
