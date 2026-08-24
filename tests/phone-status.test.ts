import { describe, expect, it } from "vitest";
import { connectionStatusFromTwilio } from "@/modules/phone/status";

describe("Twilio connection status", () => {
  it("maps terminal Twilio statuses used by scheduling", () => {
    expect(connectionStatusFromTwilio({ callStatus: "busy" })).toBe("busy");
    expect(connectionStatusFromTwilio({ callStatus: "no-answer" })).toBe("no-answer");
    expect(connectionStatusFromTwilio({ callStatus: "failed" })).toBe("failed");
    expect(connectionStatusFromTwilio({ callStatus: "canceled" })).toBe("failed");
  });

  it("treats a live human answer as answered, not completed", () => {
    expect(
      connectionStatusFromTwilio({ callStatus: "in-progress", answeredBy: "human" }),
    ).toBe("answered");
  });

  it("records voicemail from AMD instead of inferring it later", () => {
    expect(
      connectionStatusFromTwilio({ callStatus: "in-progress", answeredBy: "machine_start" }),
    ).toBe("voicemail");
    expect(
      connectionStatusFromTwilio({ callStatus: "completed", answeredBy: "machine_end_beep" }),
    ).toBe("voicemail");
  });

  it("keeps answered after a completed human call", () => {
    expect(
      connectionStatusFromTwilio({
        callStatus: "completed",
        answeredBy: "human",
        previous: "answered",
      }),
    ).toBe("answered");
  });

  it("does not treat ringing as a terminal result", () => {
    expect(connectionStatusFromTwilio({ callStatus: "queued" })).toBe("initiated");
    expect(connectionStatusFromTwilio({ callStatus: "ringing" })).toBe("ringing");
  });
});
