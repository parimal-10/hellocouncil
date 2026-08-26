import { resolvePersonTimeZone } from "@/modules/time/timezone";
import type { OutboundCallContext, PhoneCallRecord, StructuredCallOutcome } from "./types";

export const CALL_CONTEXT_LIMITS = {
  events: 8,
  attempts: 5,
  reviews: 5,
  priorCalls: 5,
} as const;

export type CallContextRows = {
  run: { id: string; caseId: string; definitionId: string; title: string; status: string; summary: string };
  caseRecord: { id: string; matterName: string };
  client: { name: string; phone: string | null; timeZone: string | null; timeZoneSource: string | null };
  assignedUserName: string;
  providerName?: string;
  providerPhone?: string | null;
  events: Array<{ type: string; summary: string; occurredAt: Date }>;
  attempts: Array<{ channel: string; outcome: string; summary: string; attemptedAt: Date }>;
  reviews: Array<{
    createdAt?: Date;
    reason: string;
    summary: string;
    status: string;
    reviewerNote?: string | null;
  }>;
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
    events: takeLatestByDate(rows.events, "occurredAt", CALL_CONTEXT_LIMITS.events),
    attempts: takeLatestByDate(rows.attempts, "attemptedAt", CALL_CONTEXT_LIMITS.attempts),
    reviews: takeLatestByOptionalDate(rows.reviews, (review) => review.createdAt, CALL_CONTEXT_LIMITS.reviews),
    priorCalls: takeLatestByDate(rows.priorCalls, "createdAt", CALL_CONTEXT_LIMITS.priorCalls).map((call) => ({
      createdAt: call.createdAt,
      connectionStatus: call.connectionStatus,
      structuredOutcome: call.structuredOutcome as StructuredCallOutcome | null,
      transcript: call.transcript,
    })),
  };
}

function takeLatestByDate<T extends Record<K, Date>, K extends keyof T>(
  items: T[],
  key: K,
  limit: number,
): T[] {
  return [...items]
    .sort((left, right) => left[key].getTime() - right[key].getTime())
    .slice(-limit);
}

function takeLatestByOptionalDate<T>(
  items: T[],
  getDate: (item: T) => Date | undefined,
  limit: number,
): T[] {
  return [...items]
    .sort((left, right) => (getDate(left)?.getTime() ?? 0) - (getDate(right)?.getTime() ?? 0))
    .slice(-limit);
}
