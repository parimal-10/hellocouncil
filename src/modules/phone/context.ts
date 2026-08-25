import { resolvePersonTimeZone } from "@/modules/time/timezone";
import type { OutboundCallContext, PhoneCallRecord, StructuredCallOutcome } from "./types";

export type CallContextRows = {
  run: { id: string; caseId: string; definitionId: string; title: string; status: string; summary: string };
  caseRecord: { id: string; matterName: string };
  client: { name: string; phone: string | null; timeZone: string | null; timeZoneSource: string | null };
  assignedUserName: string;
  providerName?: string;
  providerPhone?: string | null;
  events: Array<{ type: string; summary: string; occurredAt: Date }>;
  attempts: Array<{ channel: string; outcome: string; summary: string; attemptedAt: Date }>;
  reviews: Array<{ reason: string; summary: string; status: string; reviewerNote?: string | null }>;
  priorCalls: PhoneCallRecord[];
};

export function assembleOutboundCallContext(rows: CallContextRows): OutboundCallContext {
  const resolved = resolvePersonTimeZone({
    explicitTimeZone: rows.client.timeZone,
    phone: rows.client.phone,
  });
  return {
    caseId: rows.caseRecord.id,
    workflowRunId: rows.run.id,
    definitionId: rows.run.definitionId,
    matterName: rows.caseRecord.matterName,
    clientName: rows.client.name,
    clientPhone: rows.client.phone ?? "",
    timeZone: resolved.timeZone,
    timeZoneSource: resolved.source,
    assignedUserName: rows.assignedUserName,
    providerName: rows.providerName,
    providerPhone: rows.providerPhone ?? "",
    runTitle: rows.run.title,
    runStatus: rows.run.status,
    runSummary: rows.run.summary,
    events: rows.events,
    attempts: rows.attempts,
    reviews: rows.reviews,
    priorCalls: rows.priorCalls.map((call) => ({
      connectionStatus: call.connectionStatus,
      structuredOutcome: call.structuredOutcome as StructuredCallOutcome | null,
      transcript: call.transcript,
    })),
  };
}
