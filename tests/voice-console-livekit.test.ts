import { describe, expect, it } from "vitest";
import { voiceSessionLabel } from "@/modules/dashboard/queries";

describe("voice console LiveKit labels", () => {
  it("includes LiveKit room metadata when available", () => {
    expect(
      voiceSessionLabel({
        provider: "livekit",
        status: "running",
        roomName: "workflow-run-1",
        startedAt: new Date("2026-08-23T00:00:00.000Z"),
      }),
    ).toBe("livekit - running - workflow-run-1");
  });
});
