import { DateTime } from "luxon";
import { NANP_AREA_CODE_TIMEZONES, NON_GEOGRAPHIC_NANP_CODES } from "./nanp-area-codes";

export type TimeZoneSource = "explicit" | "phone_area_code" | "fallback";

export type ResolvedTimeZone = {
  timeZone: string;
  source: TimeZoneSource;
};

export type LocalWallClock = {
  timeZone: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

export type ClientTimeResolution =
  | { ok: true; utc: Date; localLabel: string; timeZone: string }
  | { ok: false; error: string };

const FALLBACK_TIME_ZONE = "America/New_York";

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const SMALL_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone !== timeZone.trim()) return false;
  if (/^[+-]\d{2}:\d{2}$/.test(timeZone) || /^GMT[+-]/i.test(timeZone)) return false;
  if (!timeZone.includes("/") && timeZone !== "UTC" && timeZone !== "GMT") return false;
  return DateTime.now().setZone(timeZone).isValid;
}

export function inferTimeZoneFromPhone(phone: string): ResolvedTimeZone | null {
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  const areaCode = national.slice(0, 3);
  if (NON_GEOGRAPHIC_NANP_CODES.has(areaCode)) return null;
  const timeZone = NANP_AREA_CODE_TIMEZONES[areaCode];
  if (!timeZone) return null;
  return { timeZone, source: "phone_area_code" };
}

export function resolvePersonTimeZone(input: {
  explicitTimeZone?: string | null;
  phone?: string | null;
  fallbackTimeZone?: string;
}): ResolvedTimeZone {
  if (input.explicitTimeZone && isValidIanaTimeZone(input.explicitTimeZone)) {
    return { timeZone: input.explicitTimeZone, source: "explicit" };
  }
  const fromPhone = input.phone ? inferTimeZoneFromPhone(input.phone) : null;
  if (fromPhone) return fromPhone;
  const fallback = input.fallbackTimeZone ?? FALLBACK_TIME_ZONE;
  if (!isValidIanaTimeZone(fallback)) {
    throw new Error(`Fallback timezone is not a valid IANA zone: ${fallback}`);
  }
  return { timeZone: fallback, source: "fallback" };
}

export function toUtcFromLocal(input: LocalWallClock): Date {
  if (!isValidIanaTimeZone(input.timeZone)) {
    throw new Error(`Not a valid IANA timezone: ${input.timeZone}`);
  }
  const local = DateTime.fromObject(
    {
      year: input.year,
      month: input.month,
      day: input.day,
      hour: input.hour,
      minute: input.minute,
      second: input.second ?? 0,
      millisecond: 0,
    },
    { zone: input.timeZone },
  );
  if (!local.isValid || local.hour !== input.hour || local.minute !== input.minute) {
    throw new Error("That local time does not exist in this timezone.");
  }
  return local.toUTC().toJSDate();
}

export function formatInTimeZone(instant: Date, timeZone: string): string {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(`Not a valid IANA timezone: ${timeZone}`);
  }
  return DateTime.fromJSDate(instant, { zone: "utc" }).setZone(timeZone).toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ");
}

export function resolveClientTimeExpression(
  expression: string,
  timeZone: string,
  now: Date,
): ClientTimeResolution {
  if (!isValidIanaTimeZone(timeZone)) {
    return { ok: false, error: "Could not understand that time because the client's timezone is missing." };
  }
  const trimmed = expression.trim();
  if (!trimmed) {
    return { ok: false, error: "Could not understand that time." };
  }
  if (/\bUTC\b/i.test(trimmed) || /[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return { ok: false, error: "Could not understand that time. Please use a local date and time, not a UTC timestamp." };
  }

  const nowLocal = DateTime.fromJSDate(now, { zone: "utc" }).setZone(timeZone);
  const parsed = parseLocalExpression(trimmed, nowLocal, timeZone);
  if (!parsed) {
    return { ok: false, error: "Could not understand that time. Try something like Tuesday at 3pm." };
  }
  if (!parsed.isValid) {
    return { ok: false, error: "Could not understand that time because it does not exist on that day." };
  }
  return {
    ok: true,
    utc: parsed.toUTC().toJSDate(),
    localLabel: formatInTimeZone(parsed.toUTC().toJSDate(), timeZone),
    timeZone,
  };
}

function parseLocalExpression(expression: string, nowLocal: DateTime, timeZone: string): DateTime | null {
  const isoLocal = parseZoneLessIso(expression, timeZone);
  if (isoLocal) return isoLocal;

  const relative = parseRelativeDelay(expression, nowLocal);
  if (relative) return relative;

  const weekdayMatch = expression.match(
    /^(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)(?:\s+at\s+(.+))?$/i,
  );
  if (weekdayMatch) {
    const time = parseTimeOfDay(weekdayMatch[2] ?? "9:00 am");
    if (!time) return null;
    return weekdayDateTime(nowLocal, weekdayMatch[1].toLowerCase(), time, /^next\s+/i.test(expression));
  }

  const atMatch = expression.match(/^at\s+(.+)$/i);
  if (atMatch) {
    const time = parseTimeOfDay(atMatch[1]);
    if (!time) return null;
    return weekdayDateTime(nowLocal, "today", time, false);
  }

  return null;
}

function parseRelativeDelay(expression: string, nowLocal: DateTime): DateTime | null {
  const match = expression.match(
    /^(?:call\s+(?:me|us)\s+)?(?:back\s+)?in\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(minutes?|mins?|hours?|hrs?)$/i,
  );
  if (!match) return null;
  const amount = parseRelativeAmount(match[1]);
  if (!amount || amount < 1) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith("hour") || unit.startsWith("hr")) {
    return nowLocal.plus({ hours: amount });
  }
  return nowLocal.plus({ minutes: amount });
}

function parseRelativeAmount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return SMALL_NUMBER_WORDS[raw.toLowerCase()] ?? null;
}

function parseZoneLessIso(expression: string, timeZone: string): DateTime | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(expression)) return null;
  const local = DateTime.fromISO(expression, { zone: timeZone });
  return local.isValid ? local : null;
}

function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") hour = hour === 12 ? 0 : hour;
    if (meridiem === "pm") hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function weekdayDateTime(
  nowLocal: DateTime,
  weekday: string,
  time: { hour: number; minute: number },
  forceNextWeek: boolean,
): DateTime {
  let daysAhead = 0;
  if (weekday === "tomorrow") {
    daysAhead = 1;
  } else if (weekday !== "today") {
    const target = WEEKDAYS[weekday];
    daysAhead = (target - nowLocal.weekday + 7) % 7;
    if (forceNextWeek && daysAhead === 0) daysAhead = 7;
  }
  let candidate = nowLocal.plus({ days: daysAhead }).set({
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  });
  if (daysAhead === 0 && candidate <= nowLocal) {
    candidate = candidate.plus({ days: weekday === "today" ? 1 : 7 });
  }
  return candidate;
}
