import { describe, expect, it } from "vitest";
import { buildCallBriefing } from "@/modules/phone/conversation";
import type { OutboundCallContext } from "@/modules/phone/types";

const now = new Date("2026-08-24T17:00:00.000Z");

function context(overrides: Partial<OutboundCallContext> = {}): OutboundCallContext {
  return {
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
    runTitle: "Northside Imaging records follow-up",
    runStatus: "active",
    runSummary: "Authorization verified. Waiting on records.",
    events: [],
    attempts: [],
    reviews: [],
    priorCalls: [],
    ...overrides,
  };
}

describe("phone call briefing", () => {
  it("uses a concise provider-purpose prompt instead of a generic full-history script", () => {
    const briefing = buildCallBriefing(context(), now, "provider_follow_up");

    expect(briefing).toContain("Call target: Northside Imaging (records desk).");
    expect(briefing).toContain("Goal: get medical-records status for Jordan Lee.");
    expect(briefing).toContain("Ask one question at a time");
    expect(briefing).toContain("Never mention UTC, GMT, or ISO timestamps");
    expect(briefing).not.toContain("Full history of prior interactions");
    expect(briefing).not.toContain("Conduct the conversation autonomously");
  });

  it("summarizes prior calls from structured outcomes without dumping raw transcripts", () => {
    const briefing = buildCallBriefing(
      context({
        priorCalls: [
          {
            connectionStatus: "answered",
            structuredOutcome: {
              status: "records expected Friday",
              urgency: "normal",
              sentiment: "neutral",
              newInformation: [
                "Records are expected Friday.",
                "Provider has the signed authorization.",
              ],
              requestedCallbackAt: null,
              requestedCallbackLocal: null,
              shouldContinueOutreach: true,
              recommendedFollowUpHours: 24,
            },
            transcript: [
              {
                speaker: "client",
                text: "RAW TRANSCRIPT SHOULD NOT APPEAR because this was a long noisy phone exchange.",
                occurredAt: now,
              },
            ],
          },
        ],
      }),
      now,
      "provider_follow_up",
    );

    expect(briefing).toContain("records expected Friday");
    expect(briefing).toContain("Records are expected Friday.");
    expect(briefing).toContain("Provider has the signed authorization.");
    expect(briefing).not.toContain("RAW TRANSCRIPT SHOULD NOT APPEAR");
  });

  it("keeps only bounded recent context from noisy histories", () => {
    const briefing = buildCallBriefing(
      context({
        events: Array.from({ length: 8 }, (_, index) => ({
          type: "workflow.event",
          summary: `Event ${index + 1}`,
          occurredAt: new Date(Date.UTC(2026, 7, 20 + index, 12)),
        })),
        attempts: Array.from({ length: 6 }, (_, index) => ({
          channel: "phone",
          outcome: "failed",
          summary: `Attempt ${index + 1}`,
          attemptedAt: new Date(Date.UTC(2026, 7, 20 + index, 13)),
        })),
        reviews: Array.from({ length: 5 }, (_, index) => ({
          createdAt: new Date(Date.UTC(2026, 7, 20 + index, 11)),
          reason: "provider_refusal",
          summary: `Review ${index + 1}`,
          status: index === 4 ? "open" : "resolved",
          reviewerNote: null,
        })),
        priorCalls: Array.from({ length: 5 }, (_, index) => ({
          createdAt: new Date(Date.UTC(2026, 7, 20 + index, 14)),
          connectionStatus: "answered",
          structuredOutcome: {
            status: `Outcome ${index + 1}`,
            urgency: "normal",
            sentiment: "neutral",
            newInformation: [`Information ${index + 1}`],
            requestedCallbackAt: null,
            requestedCallbackLocal: null,
            shouldContinueOutreach: true,
            recommendedFollowUpHours: null,
          },
          transcript: [],
        })),
      }),
      now,
      "provider_follow_up",
    );

    expect(briefing).not.toContain("Event 1");
    expect(briefing).not.toContain("Attempt 1");
    expect(briefing).not.toContain("Outcome 1");
    expect(briefing).toContain("Event 8");
    expect(briefing).toContain("Attempt 6");
    expect(briefing).toContain("Outcome 5");
    expect(briefing).toContain("Review 5");
  });
});
