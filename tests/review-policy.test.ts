import { describe, expect, it } from "vitest";
import { evaluateHumanReviewPolicy } from "@/modules/workflows/review-policy";
import type { WorkflowSignal } from "@/modules/workflows/types";

const baseSignal: WorkflowSignal = {
  text: "The records are in process.",
  channel: "phone",
  attemptCount: 1,
  hasAuthorization: true,
  actorRole: "provider",
};

describe("human review policy", () => {
  it("blocks missing provider authorization", () => {
    const decision = evaluateHumanReviewPolicy({ ...baseSignal, hasAuthorization: false });
    expect(decision).toMatchObject({ kind: "block", reason: "missing_authorization" });
  });

  it("blocks ambiguous client responses", () => {
    const decision = evaluateHumanReviewPolicy({
      ...baseSignal,
      actorRole: "client",
      text: "I am not sure, maybe my pain is worse.",
    });
    expect(decision).toMatchObject({ kind: "block", reason: "ambiguous_client_response" });
  });

  it("blocks provider refusal", () => {
    const decision = evaluateHumanReviewPolicy({
      ...baseSignal,
      text: "We cannot release anything without a new request.",
    });
    expect(decision).toMatchObject({ kind: "block", reason: "provider_refusal" });
  });

  it("allows ordinary status updates", () => {
    const decision = evaluateHumanReviewPolicy(baseSignal);
    expect(decision).toEqual({ kind: "allow" });
  });
});
