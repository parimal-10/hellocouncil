import type { VoiceSessionEvent } from "@/modules/voice/types";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  routeWorkflowAction: vi.fn().mockResolvedValue({ ok: true, message: "updated" }),
  startSession: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/workflows/action-router", () => ({ routeWorkflowAction: mocks.routeWorkflowAction }));
vi.mock("@/modules/workflows/definitions", () => ({
  medicalRecordsFollowUpDefinition: { id: "medical-records-follow-up" },
  clientCheckInDefinition: { id: "client-check-in" },
  workflowDefinitions: [{ id: "medical-records-follow-up" }, { id: "client-check-in" }],
  getWorkflowDefinition: mocks.getWorkflowDefinition,
}));
vi.mock("@/modules/workflows/engine", () => ({ WorkflowEngine: class WorkflowEngine {} }));
vi.mock("@/modules/workflows/store", () => ({
  DrizzleWorkflowStore: class DrizzleWorkflowStore {
    getRun = mocks.getRun;
  },
}));
vi.mock("@/modules/voice/simulated-adapter", () => ({
  SimulatedVoiceSessionAdapter: class SimulatedVoiceSessionAdapter {
    startSession(input: { caseId: string; workflowRunId: string }): AsyncIterable<VoiceSessionEvent> {
      mocks.startSession(input);
      return (async function* (): AsyncGenerator<VoiceSessionEvent> {
        yield {
          type: "tool_call",
          sessionId: "sim-run-authoritative",
          toolCallId: "tool-1",
          action: {
            type: "create_update",
            workflowRunId: "run-authoritative",
            summary: "Northside says records will be ready Friday.",
            source: "voice_session",
          },
          occurredAt: new Date(),
        };
      })();
    }
  },
}));
vi.mock("@/modules/voice/store", () => ({
  DrizzleVoiceSessionStore: class DrizzleVoiceSessionStore {
    createSession = async () => "voice-1";
    appendSessionEvent = async () => undefined;
    completeSession = async () => undefined;
  },
}));

import { runSimulatedVoiceSessionAction } from "../app/actions/voice";

describe("runSimulatedVoiceSessionAction", () => {
  it("uses the workflow run's case and definition when form fields are tampered", async () => {
    const definition = { id: "medical-records-follow-up" };
    mocks.getRun.mockResolvedValue({
      id: "run-authoritative",
      definitionId: "medical-records-follow-up",
      caseId: "case-authoritative",
      status: "active",
      title: "Records follow-up",
      summary: "",
    });
    mocks.getWorkflowDefinition.mockReturnValue(definition);

    const formData = new FormData();
    formData.set("workflowRunId", "run-authoritative");
    formData.set("caseId", "case-tampered");
    formData.set("definitionId", "client-check-in");

    await runSimulatedVoiceSessionAction(formData);

    expect(mocks.getRun).toHaveBeenCalledWith("run-authoritative");
    expect(mocks.getWorkflowDefinition).toHaveBeenCalledWith("medical-records-follow-up");
    expect(mocks.startSession).toHaveBeenCalledWith({ caseId: "case-authoritative", workflowRunId: "run-authoritative" });
    expect(mocks.routeWorkflowAction).toHaveBeenCalledWith(
      expect.objectContaining({
        definition,
        action: expect.objectContaining({ workflowRunId: "run-authoritative" }),
      }),
    );
  });
});
