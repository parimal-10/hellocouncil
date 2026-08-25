import { DateTime } from "luxon";
import { isValidIanaTimeZone } from "@/modules/time/timezone";
import type { ConnectionStatus, StructuredCallOutcome } from "./types";

export const FOLLOW_UP_POLICY = {
  id: "follow-up-v1",
  businessHours: {
    startHour: 9,
    endHour: 17,
    weekdays: [1, 2, 3, 4, 5],
  },
  retry: {
    firstDelayHours: 2,
    nextBusinessDayHour: 10,
    maxConnectAttempts: 3,
  },
  concluded: {
    defaultHours: 72,
    highUrgencyHours: 24,
    minHours: 4,
    maxHours: 336,
  },
} as const;

export type FollowUpAction = "place_now" | "defer_to_window" | "schedule" | "retry" | "human_review" | "complete";

export type FollowUpDecision = {
  action: FollowUpAction;
  dueAt: Date | null;
  reason: string;
  policyId: typeof FOLLOW_UP_POLICY.id;
  metadata: Record<string, unknown>;
};

const HIGH_URGENCY_TERMS = ["hospital", "surgery", "court", "deadline", "emergency", "worsening"];

export function isWithinLocalBusinessHours(now: Date, timeZone: string): boolean {
  const local = requireLocal(now, timeZone);
  return isWeekday(local) && local.hour >= FOLLOW_UP_POLICY.businessHours.startHour && local.hour < FOLLOW_UP_POLICY.businessHours.endHour;
}

export function nextLocalBusinessWindow(
  now: Date,
  timeZone: string,
  hour: number = FOLLOW_UP_POLICY.businessHours.startHour,
): Date {
  const local = requireLocal(now, timeZone);
  const todayAtHour = local.set({ hour, minute: 0, second: 0, millisecond: 0 });
  if (isWeekday(local) && todayAtHour > local) {
    return todayAtHour.toUTC().toJSDate();
  }
  let next = local.plus({ days: 1 }).set({ hour, minute: 0, second: 0, millisecond: 0 });
  while (!isWeekday(next)) {
    next = next.plus({ days: 1 });
  }
  return next.toUTC().toJSDate();
}

export function snapToLocalBusinessHours(instant: Date, timeZone: string): Date {
  if (isWithinLocalBusinessHours(instant, timeZone)) return instant;
  const local = requireLocal(instant, timeZone);
  if (isWeekday(local) && local.hour < FOLLOW_UP_POLICY.businessHours.startHour) {
    return local
      .set({ hour: FOLLOW_UP_POLICY.businessHours.startHour, minute: 0, second: 0, millisecond: 0 })
      .toUTC()
      .toJSDate();
  }
  return nextLocalBusinessWindow(instant, timeZone, FOLLOW_UP_POLICY.businessHours.startHour);
}

export function decideAttemptWindow(input: { now: Date; timeZone: string }): FollowUpDecision {
  if (isWithinLocalBusinessHours(input.now, input.timeZone)) {
    return decision("place_now", null, "Client is inside local weekday business hours, so the call can be placed now.", {
      rule: "in_business_hours",
      timeZone: input.timeZone,
      snappedToBusinessHours: false,
    });
  }
  const dueAt = snapToLocalBusinessHours(input.now, input.timeZone);
  return decision(
    "defer_to_window",
    dueAt,
    "Automatic calls are only placed during local business hours (weekday 9:00 AM–5:00 PM). This attempt was deferred to the next window.",
    {
      rule: "outside_business_hours",
      timeZone: input.timeZone,
      snappedToBusinessHours: true,
    },
  );
}

export function decideNextFollowUp(input: {
  connectionStatus: ConnectionStatus;
  now: Date;
  timeZone: string;
  failedConnectCount: number;
  structuredOutcome?: StructuredCallOutcome | null;
  defaultFollowUpHours?: number;
}): FollowUpDecision {
  if (isNoConnect(input.connectionStatus)) {
    return decideRetry(input);
  }
  return decideAfterConversation(input);
}

function decideRetry(input: {
  connectionStatus: ConnectionStatus;
  now: Date;
  timeZone: string;
  failedConnectCount: number;
}): FollowUpDecision {
  const count = input.failedConnectCount;
  if (count >= FOLLOW_UP_POLICY.retry.maxConnectAttempts) {
    return decision(
      "human_review",
      null,
      `Reached ${FOLLOW_UP_POLICY.retry.maxConnectAttempts} unsuccessful connect attempts (${input.connectionStatus}). Flag for human review; do not auto-dial again.`,
      {
        rule: "max_connect_attempts",
        failedConnectCount: count,
        connectionStatus: input.connectionStatus,
        timeZone: input.timeZone,
      },
    );
  }

  if (count <= 1) {
    const raw = addHours(input.now, FOLLOW_UP_POLICY.retry.firstDelayHours);
    const dueAt = snapToLocalBusinessHours(raw, input.timeZone);
    return decision(
      "retry",
      dueAt,
      `No connect (${input.connectionStatus}). First retry in ${FOLLOW_UP_POLICY.retry.firstDelayHours} hours, snapped to local business hours if needed.`,
      {
        rule: "retry_same_day",
        failedConnectCount: count,
        connectionStatus: input.connectionStatus,
        timeZone: input.timeZone,
        snappedToBusinessHours: dueAt.getTime() !== raw.getTime(),
      },
    );
  }

  const dueAt = nextLocalBusinessWindow(input.now, input.timeZone, FOLLOW_UP_POLICY.retry.nextBusinessDayHour);
  return decision(
    "retry",
    dueAt,
    `No connect (${input.connectionStatus}). Second retry is 10:00 AM local on the next business day.`,
    {
      rule: "retry_next_business_day",
      failedConnectCount: count,
      connectionStatus: input.connectionStatus,
      timeZone: input.timeZone,
      snappedToBusinessHours: true,
    },
  );
}

function decideAfterConversation(input: {
  now: Date;
  timeZone: string;
  structuredOutcome?: StructuredCallOutcome | null;
  defaultFollowUpHours?: number;
}): FollowUpDecision {
  const outcome = input.structuredOutcome;
  if (outcome && outcome.shouldContinueOutreach === false) {
    return decision("complete", null, "The client asked not to continue outreach. No automatic follow-up will be scheduled.", {
      rule: "stop_outreach",
      timeZone: input.timeZone,
      status: outcome.status,
    });
  }

  if (outcome?.requestedCallbackAt) {
    const dueAt = new Date(outcome.requestedCallbackAt);
    if (!Number.isNaN(dueAt.getTime()) && dueAt > input.now) {
      return decision("schedule", dueAt, "Client requested a specific callback time. Scheduling that exact local-resolved instant.", {
        rule: "client_requested_time",
        timeZone: input.timeZone,
        requestedCallbackLocal: outcome.requestedCallbackLocal,
        snappedToBusinessHours: false,
      });
    }
  }

  if (typeof outcome?.recommendedFollowUpHours === "number") {
    return intervalDecision({
      now: input.now,
      timeZone: input.timeZone,
      requestedHours: outcome.recommendedFollowUpHours,
      rule: "agent_recommended_interval",
      reason: "The call agent recommended a follow-up interval from the conversation.",
    });
  }

  if (isHighUrgency(outcome)) {
    return intervalDecision({
      now: input.now,
      timeZone: input.timeZone,
      requestedHours: FOLLOW_UP_POLICY.concluded.highUrgencyHours,
      rule: "high_urgency_interval",
      reason: "The conversation indicated high urgency, so the next check-in is in 24 hours.",
    });
  }

  const defaultHours = input.defaultFollowUpHours ?? FOLLOW_UP_POLICY.concluded.defaultHours;
  return intervalDecision({
    now: input.now,
    timeZone: input.timeZone,
    requestedHours: defaultHours,
    rule: "default_interval",
    reason: `Conversation concluded normally. Next check-in uses the workflow default of ${defaultHours} hours.`,
  });
}

function intervalDecision(input: {
  now: Date;
  timeZone: string;
  requestedHours: number;
  rule: string;
  reason: string;
}): FollowUpDecision {
  const appliedHours = clampHours(input.requestedHours);
  const raw = addHours(input.now, appliedHours);
  const dueAt = snapToLocalBusinessHours(raw, input.timeZone);
  return decision("schedule", dueAt, input.reason, {
    rule: input.rule,
    timeZone: input.timeZone,
    requestedHours: input.requestedHours,
    appliedHours,
    snappedToBusinessHours: dueAt.getTime() !== raw.getTime(),
  });
}

function isNoConnect(status: ConnectionStatus): boolean {
  return status === "no-answer" || status === "voicemail" || status === "busy" || status === "failed";
}

function isHighUrgency(outcome?: StructuredCallOutcome | null): boolean {
  if (!outcome) return false;
  if (outcome.urgency === "high") return true;
  const haystack = `${outcome.status} ${outcome.newInformation.join(" ")}`.toLowerCase();
  return HIGH_URGENCY_TERMS.some((term) => haystack.includes(term));
}

function clampHours(hours: number): number {
  return Math.min(FOLLOW_UP_POLICY.concluded.maxHours, Math.max(FOLLOW_UP_POLICY.concluded.minHours, hours));
}

function addHours(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function decision(
  action: FollowUpAction,
  dueAt: Date | null,
  reason: string,
  metadata: Record<string, unknown>,
): FollowUpDecision {
  return { action, dueAt, reason, policyId: FOLLOW_UP_POLICY.id, metadata };
}

function requireLocal(now: Date, timeZone: string): DateTime {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(`Not a valid IANA timezone: ${timeZone}`);
  }
  return DateTime.fromJSDate(now, { zone: "utc" }).setZone(timeZone);
}

function isWeekday(local: DateTime): boolean {
  return (FOLLOW_UP_POLICY.businessHours.weekdays as readonly number[]).includes(local.weekday);
}
