import { describe, expect, it } from "vitest";
import { isAutomaticOutboundCallingEnabled } from "@/modules/phone/auto-dial";
import {
  FOLLOW_UP_POLICY,
  decideAttemptWindow,
  decideNextFollowUp,
  isWithinLocalBusinessHours,
  nextLocalBusinessWindow,
  snapToLocalBusinessHours,
} from "@/modules/phone/follow-up-policy";
import type { StructuredCallOutcome } from "@/modules/phone/types";

const chicago = "America/Chicago";
// Monday 24 Aug 2026 12:00 CDT
const mondayNoon = new Date("2026-08-24T17:00:00.000Z");
// Monday 8:30 AM CDT
const mondayMorning = new Date("2026-08-24T13:30:00.000Z");
// Monday 4:00 PM CDT
const mondayAfternoon = new Date("2026-08-24T21:00:00.000Z");
// Friday 4:30 PM CDT
const fridayAfternoon = new Date("2026-08-28T21:30:00.000Z");
// Saturday 11:00 AM CDT
const saturdayMorning = new Date("2026-08-29T16:00:00.000Z");

function outcome(overrides: Partial<StructuredCallOutcome> = {}): StructuredCallOutcome {
  return {
    newInformation: [],
    requestedCallbackAt: null,
    requestedCallbackLocal: null,
    status: "check-in complete",
    sentiment: "neutral",
    shouldContinueOutreach: true,
    recommendedFollowUpHours: null,
    urgency: "normal",
    ...overrides,
  };
}

describe("follow-up policy constants", () => {
  it("publishes the concrete defaults used by orchestration", () => {
    expect(FOLLOW_UP_POLICY).toMatchObject({
      id: "follow-up-v1",
      businessHours: { startHour: 9, endHour: 17, weekdays: [1, 2, 3, 4, 5] },
      retry: { firstDelayHours: 2, nextBusinessDayHour: 10, maxConnectAttempts: 3 },
      concluded: { defaultHours: 72, highUrgencyHours: 24, minHours: 4, maxHours: 336 },
    });
  });
});

describe("local business hours", () => {
  it("treats weekday 9:00 AM–5:00 PM client-local as the calling window", () => {
    expect(isWithinLocalBusinessHours(mondayNoon, chicago)).toBe(true);
    expect(isWithinLocalBusinessHours(mondayMorning, chicago)).toBe(false);
    expect(isWithinLocalBusinessHours(saturdayMorning, chicago)).toBe(false);
  });

  it("snaps outside-window times forward to the next 9:00 AM weekday", () => {
    expect(snapToLocalBusinessHours(mondayMorning, chicago).toISOString()).toBe("2026-08-24T14:00:00.000Z");
    expect(snapToLocalBusinessHours(saturdayMorning, chicago).toISOString()).toBe("2026-08-31T14:00:00.000Z");
    expect(snapToLocalBusinessHours(mondayNoon, chicago).toISOString()).toBe(mondayNoon.toISOString());
  });

  it("computes the next 10:00 AM business-day retry from Friday afternoon as Monday", () => {
    expect(nextLocalBusinessWindow(fridayAfternoon, chicago, 10).toISOString()).toBe("2026-08-31T15:00:00.000Z");
  });
});

describe("decideAttemptWindow", () => {
  it("places now when the client is inside local business hours", () => {
    const decision = decideAttemptWindow({ now: mondayNoon, timeZone: chicago });
    expect(decision.action).toBe("place_now");
    expect(decision.dueAt).toBeNull();
    expect(decision.metadata.timeZone).toBe(chicago);
  });

  it("defers to the next local window instead of dialing at night or on weekends", () => {
    const decision = decideAttemptWindow({ now: mondayMorning, timeZone: chicago });
    expect(decision.action).toBe("defer_to_window");
    expect(decision.dueAt?.toISOString()).toBe("2026-08-24T14:00:00.000Z");
    expect(decision.reason).toMatch(/local business hours/i);
    expect(decision.metadata.snappedToBusinessHours).toBe(true);
  });
});

describe("decideNextFollowUp after a call", () => {
  it("honors an explicit client callback time without snapping it to business hours", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "answered",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 0,
      structuredOutcome: outcome({
        requestedCallbackAt: "2026-08-25T01:00:00.000Z", // Monday 8:00 PM CDT
        requestedCallbackLocal: "Monday, August 24, 2026 at 8:00 PM CDT",
      }),
    });
    expect(decision.action).toBe("schedule");
    expect(decision.dueAt?.toISOString()).toBe("2026-08-25T01:00:00.000Z");
    expect(decision.metadata.rule).toBe("client_requested_time");
    expect(decision.metadata.snappedToBusinessHours).toBe(false);
  });

  it("uses the agent's recommended interval, clamped, then snaps to business hours", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "answered",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 0,
      structuredOutcome: outcome({ recommendedFollowUpHours: 1 }),
      defaultFollowUpHours: 72,
    });
    expect(decision.action).toBe("schedule");
    expect(decision.metadata.rule).toBe("agent_recommended_interval");
    expect(decision.metadata.requestedHours).toBe(1);
    expect(decision.metadata.appliedHours).toBe(4);
    expect(decision.dueAt?.toISOString()).toBe("2026-08-24T21:00:00.000Z");
  });

  it("uses a 24h interval for high urgency, otherwise the workflow default", () => {
    const urgent = decideNextFollowUp({
      connectionStatus: "answered",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 0,
      structuredOutcome: outcome({ urgency: "high", newInformation: ["Client is in the hospital."] }),
      defaultFollowUpHours: 72,
    });
    const normal = decideNextFollowUp({
      connectionStatus: "answered",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 0,
      structuredOutcome: outcome(),
      defaultFollowUpHours: 72,
    });
    expect(urgent.metadata.rule).toBe("high_urgency_interval");
    expect(urgent.metadata.appliedHours).toBe(24);
    expect(normal.metadata.rule).toBe("default_interval");
    expect(normal.metadata.appliedHours).toBe(72);
  });

  it("stops outreach when the client asked not to be called again", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "answered",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 0,
      structuredOutcome: outcome({ shouldContinueOutreach: false, status: "do not call again" }),
    });
    expect(decision.action).toBe("complete");
    expect(decision.dueAt).toBeNull();
    expect(decision.metadata.rule).toBe("stop_outreach");
  });

  it("retries a first no-connect in 2 hours when that is still inside the window", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "no-answer",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 1,
    });
    expect(decision.action).toBe("retry");
    expect(decision.dueAt?.toISOString()).toBe("2026-08-24T19:00:00.000Z");
    expect(decision.metadata.rule).toBe("retry_same_day");
    expect(decision.metadata.failedConnectCount).toBe(1);
  });

  it("snaps a first retry that would land after 5pm to the next morning", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "voicemail",
      now: mondayAfternoon,
      timeZone: chicago,
      failedConnectCount: 1,
    });
    expect(decision.action).toBe("retry");
    expect(decision.dueAt?.toISOString()).toBe("2026-08-25T14:00:00.000Z");
    expect(decision.metadata.snappedToBusinessHours).toBe(true);
  });

  it("schedules the second retry for 10:00 AM the next business day", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "busy",
      now: fridayAfternoon,
      timeZone: chicago,
      failedConnectCount: 2,
    });
    expect(decision.action).toBe("retry");
    expect(decision.dueAt?.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(decision.metadata.rule).toBe("retry_next_business_day");
  });

  it("flags the case for human review after three failed connect attempts", () => {
    const decision = decideNextFollowUp({
      connectionStatus: "failed",
      now: mondayNoon,
      timeZone: chicago,
      failedConnectCount: 3,
    });
    expect(decision.action).toBe("human_review");
    expect(decision.dueAt).toBeNull();
    expect(decision.metadata.rule).toBe("max_connect_attempts");
  });
});

describe("automatic outbound calling gate", () => {
  it("is on exactly when AUTO_OUTBOUND_CALLS=true, regardless of environment", () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(isAutomaticOutboundCallingEnabled(env({}))).toBe(false);
    expect(isAutomaticOutboundCallingEnabled(env({ AUTO_OUTBOUND_CALLS: "false" }))).toBe(false);
    expect(isAutomaticOutboundCallingEnabled(env({ AUTO_OUTBOUND_CALLS: "true" }))).toBe(true);
    expect(isAutomaticOutboundCallingEnabled(env({ NODE_ENV: "production", AUTO_OUTBOUND_CALLS: "true" }))).toBe(true);
    expect(isAutomaticOutboundCallingEnabled(env({ NODE_ENV: "test", AUTO_OUTBOUND_CALLS: "true" }))).toBe(true);
  });
});
