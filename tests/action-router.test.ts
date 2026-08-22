import { describe, expect, it, vi } from "vitest";
import { routeWorkflowAction } from "@/modules/workflows/action-router";
import { medicalRecordsFollowUpDefinition } from "@/modules/workflows/definitions";
import type { WorkflowAction } from "@/modules/workflows/types";

describe("workflow action router", () => {
  it("routes allowed tool calls through the workflow engine", async () => {
    const applyAction = vi.fn().mockResolvedValue({ ok: true, message: "updated" });
    const action: WorkflowAction = {
      type: "create_update",
      workflowRunId: "run-1",
      summary: "Provider says records will be ready Friday.",
      source: "voice_session",
    };

    const result = await routeWorkflowAction({
      action,
      definition: medicalRecordsFollowUpDefinition,
      engine: { applyAction },
    });

    expect(result).toEqual({ ok: true, message: "updated" });
    expect(applyAction).toHaveBeenCalledWith(action);
  });

  it("rejects a tool call not allowed by a workflow definition", async () => {
    const applyAction = vi.fn();
    const definition = { ...medicalRecordsFollowUpDefinition, allowedActions: ["create_update"] };
    const action: WorkflowAction = {
      type: "request_review",
      workflowRunId: "run-1",
      reason: "provider_refusal",
      summary: "Provider refused.",
    };

    await expect(
      routeWorkflowAction({ action, definition, engine: { applyAction } }),
    ).rejects.toThrow("Action request_review is not allowed");
  });
});
