import { formatInTimeZone } from "@/modules/time/timezone";
import { resolveOutboundCallee } from "./callee";
import type { ChatMessage } from "./llm";
import type { OutboundCallContext, PhoneCallRecord } from "./types";

const END_CALL_MARKER = "[[END_CALL]]";
const MAX_RECENT_EVENTS = 4;
const MAX_RECENT_ATTEMPTS = 3;
const MAX_RECENT_REVIEWS = 3;
const MAX_PRIOR_CALLS = 3;
const MAX_TRANSCRIPT_EXCERPTS = 2;
const MAX_TEXT_LENGTH = 220;

export function buildCallBriefing(context: OutboundCallContext, now: Date, stepType?: string | null): string {
  const callee = resolveOutboundCallee(context, stepType);
  const party = callee.role === "provider" ? "records desk" : "client";
  const goal =
    callee.role === "provider"
      ? `Goal: get medical-records status for ${context.clientName}. Confirm whether the request and authorization are on file, what is missing, and when records will be sent.`
      : `Goal: check in with ${context.clientName} about the case and capture any needed follow-up.`;

  return [
    "You are HelloCounsel's outbound legal-operations calling agent.",
    `Call target: ${callee.name} (${party}).`,
    `Matter: ${context.matterName}.`,
    `Owner: ${context.assignedUserName}.`,
    goal,
    context.providerName && callee.role !== "provider" ? `Provider involved: ${context.providerName}.` : "",
    `Local timezone for spoken dates: ${context.timeZone} (source: ${context.timeZoneSource}).`,
    `Current time in that timezone: ${formatInTimeZone(now, context.timeZone)}.`,
    "",
    "Conversation rules:",
    "- Open by identifying HelloCounsel and the purpose of the call.",
    "- Keep each turn brief. Ask one question at a time.",
    "- Use the context as background, not as a script to recite.",
    "- If they request a callback, confirm their requested time in local terms and end politely.",
    "- Never mention UTC, GMT, or ISO timestamps.",
    "- Do not provide legal advice. If the call raises a legal judgment or authorization problem, capture the facts and end politely.",
    `When the conversation is complete, append ${END_CALL_MARKER} after your last spoken sentence.`,
    "",
    "Context snapshot:",
    `- Workflow: ${context.runTitle}. Status: ${context.runStatus}.`,
    `- Latest summary: ${context.runSummary || "None"}.`,
    ...briefingContextLines(context),
  ]
    .filter(Boolean)
    .join("\n");
}

export function stripEndCallMarker(text: string): string {
  return text.replace(END_CALL_MARKER, "").replace(/\s+/g, " ").trim();
}

export function hasEndCallMarker(text: string): boolean {
  return text.includes(END_CALL_MARKER);
}

export function conversationMessages(call: PhoneCallRecord, latestClientText?: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: call.briefing }];
  for (const turn of call.transcript) {
    messages.push({
      role: turn.speaker === "agent" ? "assistant" : "user",
      content: turn.text,
    });
  }
  if (latestClientText) {
    messages.push({ role: "user", content: latestClientText });
  } else if (call.transcript.length === 0) {
    messages.push({ role: "user", content: "The person on the line just answered the phone. Give your opening spoken line only." });
  }
  return messages;
}

function briefingContextLines(context: OutboundCallContext): string[] {
  return [
    ...reviewLines(context),
    ...priorCallLines(context),
    ...attemptLines(context),
    ...eventLines(context),
  ];
}

function reviewLines(context: OutboundCallContext): string[] {
  return [...context.reviews]
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
    .slice(0, MAX_RECENT_REVIEWS)
    .map((review) =>
      `- Review ${review.status} (${review.reason}): ${truncateText(review.summary)}${review.reviewerNote ? ` Note: ${truncateText(review.reviewerNote)}` : ""}`,
    );
}

function priorCallLines(context: OutboundCallContext): string[] {
  return [...context.priorCalls]
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0))
    .slice(0, MAX_PRIOR_CALLS)
    .flatMap((call, index) => priorCallLine(call, index));
}

function priorCallLine(call: OutboundCallContext["priorCalls"][number], index: number): string[] {
  if (call.structuredOutcome) {
    const details = [
      call.structuredOutcome.status,
      ...call.structuredOutcome.newInformation,
      call.structuredOutcome.requestedCallbackLocal
        ? `Requested callback: ${call.structuredOutcome.requestedCallbackLocal}`
        : "",
    ]
      .filter(Boolean)
      .map(truncateText)
      .join(" ");
    return [`- Prior call ${index + 1} (${call.connectionStatus}): ${details}`];
  }

  const excerpts = call.transcript
    .filter((turn) => turn.speaker === "client")
    .slice(-MAX_TRANSCRIPT_EXCERPTS)
    .map((turn) => truncateText(turn.text));
  if (excerpts.length === 0) {
    return [`- Prior call ${index + 1} (${call.connectionStatus}): no usable outcome captured.`];
  }
  return [`- Prior call ${index + 1} (${call.connectionStatus}) client excerpts: ${excerpts.join(" / ")}`];
}

function attemptLines(context: OutboundCallContext): string[] {
  return [...context.attempts]
    .sort((left, right) => right.attemptedAt.getTime() - left.attemptedAt.getTime())
    .slice(0, MAX_RECENT_ATTEMPTS)
    .map(
      (attempt) =>
        `- Recent attempt ${formatInTimeZone(attempt.attemptedAt, context.timeZone)}: ${attempt.channel} ${attempt.outcome}: ${truncateText(attempt.summary)}`,
    );
}

function eventLines(context: OutboundCallContext): string[] {
  return [...context.events]
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
    .slice(0, MAX_RECENT_EVENTS)
    .map(
      (event) =>
        `- Recent event ${formatInTimeZone(event.occurredAt, context.timeZone)}: ${event.type}: ${truncateText(event.summary)}`,
    );
}

function truncateText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TEXT_LENGTH - 1).trimEnd()}...`;
}
