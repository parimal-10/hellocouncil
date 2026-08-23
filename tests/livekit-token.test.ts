// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createLiveKitRoomName, createParticipantIdentity } from "@/modules/livekit/token";

describe("LiveKit token helpers", () => {
  it("creates stable, scoped room names for workflow sessions", () => {
    expect(createLiveKitRoomName({ workflowRunId: "run-123" })).toBe("workflow-run-123");
  });

  it("creates participant identities scoped to the workflow run", () => {
    expect(createParticipantIdentity({ workflowRunId: "run-123" })).toBe("browser-run-123");
  });
});
