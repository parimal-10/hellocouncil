import { describe, expect, it } from "vitest";
import { evaluateOutboundCallCompliance } from "@/modules/phone/compliance";

describe("outbound call compliance flags", () => {
  it("flags quiet hours in the client's timezone without blocking the manual call", () => {
    const result = evaluateOutboundCallCompliance({
      timeZone: "America/Chicago",
      now: new Date("2026-08-25T04:30:00.000Z"),
      consentRecorded: false,
      onDoNotCallList: false,
    });
    expect(result.blocked).toBe(false);
    expect(result.flags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["quiet_hours", "consent_unconfirmed"]),
    );
    expect(result.flags.find((flag) => flag.code === "quiet_hours")?.detail).toMatch(/11:30 PM/);
    expect(result.flags.find((flag) => flag.code === "quiet_hours")?.detail).not.toMatch(/UTC/);
  });

  it("flags do-not-call matches without auto-enforcing them", () => {
    const result = evaluateOutboundCallCompliance({
      timeZone: "America/Chicago",
      now: new Date("2026-08-25T16:00:00.000Z"),
      consentRecorded: true,
      onDoNotCallList: true,
    });
    expect(result.blocked).toBe(false);
    expect(result.flags.map((flag) => flag.code)).toContain("do_not_call");
  });
});
