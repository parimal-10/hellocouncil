import { describe, expect, it } from "vitest";
import { workflowDefinitions } from "@/modules/workflows/definitions";

describe("workflow definitions", () => {
  it("registers the two assignment workflows", () => {
    expect(workflowDefinitions.map((definition) => definition.id)).toEqual([
      "medical-records-follow-up",
      "client-check-in",
    ]);
  });

  it("keeps every workflow behind the same small interface", () => {
    for (const definition of workflowDefinitions) {
      expect(definition.stepTemplates.length).toBeGreaterThan(0);
      expect(definition.allowedActions).toContain("create_update");
      expect(typeof definition.scheduleNextStep).toBe("function");
      expect(typeof definition.reviewPolicy).toBe("function");
    }
  });
});
