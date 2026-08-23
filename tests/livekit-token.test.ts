// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createLiveKitRoomName, createParticipantIdentity } from "@/modules/livekit/token";

describe("LiveKit token helpers", () => {
  it("creates room names scoped to a unique launch", () => {
    expect(createLiveKitRoomName({ workflowRunId: "run-123", launchId: "launch-456" })).toBe(
      "workflow-run-123-launch-456",
    );
  });

  it("creates participant identities scoped to a unique launch", () => {
    expect(createParticipantIdentity({ workflowRunId: "run-123", launchId: "launch-456" })).toBe(
      "browser-run-123-launch-456",
    );
  });
});
