import { describe, expect, it } from "vitest";
import {
  formatInTimeZone,
  inferTimeZoneFromPhone,
  isValidIanaTimeZone,
  resolveClientTimeExpression,
  resolvePersonTimeZone,
  toUtcFromLocal,
} from "@/modules/time/timezone";

describe("IANA timezone validation", () => {
  it("accepts real IANA zones and rejects offsets and junk", () => {
    expect(isValidIanaTimeZone("America/Chicago")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("America/Chicago ")).toBe(false);
    expect(isValidIanaTimeZone("-06:00")).toBe(false);
    expect(isValidIanaTimeZone("CST")).toBe(false);
    expect(isValidIanaTimeZone("GMT-6")).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
  });
});

describe("phone area-code inference", () => {
  it("maps NANP geographic codes to IANA zones", () => {
    expect(inferTimeZoneFromPhone("312-555-0101")).toEqual({
      timeZone: "America/Chicago",
      source: "phone_area_code",
    });
    expect(inferTimeZoneFromPhone("+1 (212) 555-0103")).toEqual({
      timeZone: "America/New_York",
      source: "phone_area_code",
    });
    expect(inferTimeZoneFromPhone("14155550102")).toEqual({
      timeZone: "America/Los_Angeles",
      source: "phone_area_code",
    });
    expect(inferTimeZoneFromPhone("+16025550104")).toEqual({
      timeZone: "America/Phoenix",
      source: "phone_area_code",
    });
  });

  it("does not guess for non-geographic or incomplete numbers", () => {
    expect(inferTimeZoneFromPhone("555-0101")).toBeNull();
    expect(inferTimeZoneFromPhone("800-555-0101")).toBeNull();
    expect(inferTimeZoneFromPhone("8885550101")).toBeNull();
    expect(inferTimeZoneFromPhone("")).toBeNull();
    expect(inferTimeZoneFromPhone("not-a-number")).toBeNull();
  });
});

describe("resolvePersonTimeZone", () => {
  it("prefers an explicit IANA zone over the phone number", () => {
    expect(
      resolvePersonTimeZone({
        explicitTimeZone: "America/Denver",
        phone: "312-555-0101",
      }),
    ).toEqual({ timeZone: "America/Denver", source: "explicit" });
  });

  it("falls back from an invalid explicit zone to the phone area code", () => {
    expect(
      resolvePersonTimeZone({
        explicitTimeZone: "-06:00",
        phone: "312-555-0101",
      }),
    ).toEqual({ timeZone: "America/Chicago", source: "phone_area_code" });
  });

  it("uses a recorded fallback when neither explicit nor phone can resolve", () => {
    expect(resolvePersonTimeZone({ phone: "555-0101" })).toEqual({
      timeZone: "America/New_York",
      source: "fallback",
    });
  });
});

describe("UTC conversion at DST boundaries", () => {
  it("converts the same wall clock to different UTC instants across DST", () => {
    const winter = toUtcFromLocal({
      timeZone: "America/Chicago",
      year: 2026,
      month: 1,
      day: 13,
      hour: 15,
      minute: 0,
    });
    const summer = toUtcFromLocal({
      timeZone: "America/Chicago",
      year: 2026,
      month: 8,
      day: 25,
      hour: 15,
      minute: 0,
    });

    expect(winter.toISOString()).toBe("2026-01-13T21:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-08-25T20:00:00.000Z");
  });

  it("round-trips a UTC instant back to the original local wall clock", () => {
    const utc = new Date("2026-08-25T20:00:00.000Z");
    const formatted = formatInTimeZone(utc, "America/Chicago");
    expect(formatted).toContain("3:00 PM");
    expect(formatted).toMatch(/CDT|Central/);
    expect(formatted).not.toMatch(/UTC|GMT|\.000Z|Z$/);
  });
});

describe("client time expressions", () => {
  const chicago = "America/Chicago";
  const mondayNoonUtc = new Date("2026-08-24T17:00:00.000Z");

  it("resolves Tuesday at 3pm in the client's zone, not the server's", () => {
    const resolved = resolveClientTimeExpression("Tuesday at 3pm", chicago, mondayNoonUtc);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.utc.toISOString()).toBe("2026-08-25T20:00:00.000Z");
    expect(resolved.localLabel).toContain("3:00 PM");
    expect(resolved.localLabel).not.toMatch(/UTC|GMT|\.000Z/);
  });

  it("moves a weekday time that already passed to the following week", () => {
    const tuesdayAfternoonUtc = new Date("2026-08-25T21:30:00.000Z");
    const resolved = resolveClientTimeExpression("Tuesday at 3pm", chicago, tuesdayAfternoonUtc);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.utc.toISOString()).toBe("2026-09-01T20:00:00.000Z");
  });

  it("does not interpret a zone-less ISO string as UTC", () => {
    const resolved = resolveClientTimeExpression("2026-08-25T15:00:00", chicago, mondayNoonUtc);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.utc.toISOString()).toBe("2026-08-25T20:00:00.000Z");
  });

  it("resolves short relative callback phrases from now", () => {
    const numeric = resolveClientTimeExpression("in 1 min", chicago, mondayNoonUtc);
    const words = resolveClientTimeExpression("in two minutes", chicago, mondayNoonUtc);

    expect(numeric.ok).toBe(true);
    expect(words.ok).toBe(true);
    if (!numeric.ok || !words.ok) return;
    expect(numeric.utc.toISOString()).toBe("2026-08-24T17:01:00.000Z");
    expect(words.utc.toISOString()).toBe("2026-08-24T17:02:00.000Z");
    expect(numeric.localLabel).toContain("12:01 PM");
  });

  it("rejects expressions it cannot resolve instead of guessing UTC", () => {
    const resolved = resolveClientTimeExpression("sometime next week", chicago, mondayNoonUtc);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error).toMatch(/could not understand/i);
    expect(resolved.error).not.toMatch(/UTC/i);
  });
});

describe("DST gap", () => {
  it("rejects a 2:30 AM that does not exist on Chicago spring-forward morning", () => {
    expect(() =>
      toUtcFromLocal({
        timeZone: "America/Chicago",
        year: 2026,
        month: 3,
        day: 8,
        hour: 2,
        minute: 30,
      }),
    ).toThrow(/does not exist/i);
  });
});
