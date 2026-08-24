import type { PhoneCallRecord, PhoneCallStore, PhoneTranscriptTurn } from "@/modules/phone/types";

export class MemoryPhoneCallStore implements PhoneCallStore {
  calls: PhoneCallRecord[] = [];
  contactAttempts: Array<{
    workflowRunId: string;
    channel: string;
    outcome: string;
    summary: string;
  }> = [];
  events: Array<{ workflowRunId: string; type: string; summary: string; payload: Record<string, unknown> }> = [];
  runSummaries = new Map<string, string>();
  scheduledFollowUps: unknown[] = [];

  async createCall(input: Omit<PhoneCallRecord, "id" | "createdAt" | "updatedAt">): Promise<PhoneCallRecord> {
    const call: PhoneCallRecord = {
      ...input,
      id: `call-${this.calls.length + 1}`,
      workflowStepId: input.workflowStepId ?? null,
      orchestrationAppliedAt: input.orchestrationAppliedAt ?? null,
      createdAt: new Date("2026-08-24T17:00:00.000Z"),
      updatedAt: new Date("2026-08-24T17:00:00.000Z"),
    };
    this.calls.push(call);
    return call;
  }

  async getCall(id: string): Promise<PhoneCallRecord | null> {
    return this.calls.find((call) => call.id === id) ?? null;
  }

  async updateCall(id: string, patch: Partial<PhoneCallRecord>): Promise<PhoneCallRecord> {
    const index = this.calls.findIndex((call) => call.id === id);
    if (index < 0) throw new Error(`Phone call not found: ${id}`);
    const updated = { ...this.calls[index]!, ...patch, updatedAt: new Date("2026-08-24T17:01:00.000Z") };
    this.calls[index] = updated;
    return updated;
  }

  async appendTranscript(id: string, turn: PhoneTranscriptTurn): Promise<PhoneCallRecord> {
    const call = await this.getCall(id);
    if (!call) throw new Error(`Phone call not found: ${id}`);
    return this.updateCall(id, { transcript: [...call.transcript, turn] });
  }

  async recordContactAttempt(input: {
    workflowRunId: string;
    workflowStepId?: string;
    channel: string;
    outcome: string;
    summary: string;
  }): Promise<string> {
    this.contactAttempts.push(input);
    return `attempt-${this.contactAttempts.length}`;
  }

  async claimOrchestration(id: string, now: Date): Promise<boolean> {
    const call = await this.getCall(id);
    if (!call || call.orchestrationAppliedAt) return false;
    await this.updateCall(id, { orchestrationAppliedAt: now });
    return true;
  }

  async appendWorkflowEvent(input: {
    workflowRunId: string;
    type: string;
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    this.events.push(input);
  }

  async updateRunSummary(workflowRunId: string, summary: string): Promise<void> {
    this.runSummaries.set(workflowRunId, summary);
  }

  async listCallsForRun(_workflowRunId: string): Promise<PhoneCallRecord[]> {
    return this.calls;
  }
}
