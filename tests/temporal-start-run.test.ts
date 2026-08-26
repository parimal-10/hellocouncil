import { describe, expect, it } from "vitest";
import { TASK_QUEUE, loadTemporalConfig } from "@/temporal/config";
import { workflowIdFor } from "@/temporal/client";
import { signalRun, startWorkflowRun } from "@/temporal/start-run";

describe("temporal start-run", () => {
  it("derives deterministic workflow ids for workflow runs", () => {
    expect(workflowIdFor("run-42")).toBe("workflow-run-run-42");
    expect(workflowIdFor("abc")).not.toContain(" ");
  });

  it("exposes starter helpers bound to the configured task queue", async () => {
    expect(typeof startWorkflowRun).toBe("function");
    expect(typeof signalRun).toBe("function");
    expect(loadTemporalConfig().taskQueue).toBe(TASK_QUEUE);
  });
});
