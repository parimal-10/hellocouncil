import { formatInTimeZone } from "@/modules/time/timezone";
import type { ChatMessage } from "./llm";
import type { OutboundCallContext, PhoneCallRecord } from "./types";

const END_CALL_MARKER = "[[END_CALL]]";

export function buildCallBriefing(context: OutboundCallContext, now: Date): string {
  const history = [
    ...context.events.map(
      (event) =>
        `- ${formatInTimeZone(event.occurredAt, context.timeZone)}: ${event.type}: ${event.summary}`,
    ),
    ...context.attempts.map(
      (attempt) =>
        `- ${formatInTimeZone(attempt.attemptedAt, context.timeZone)}: ${attempt.channel} ${attempt.outcome}: ${attempt.summary}`,
    ),
    ...context.reviews.map(
      (review) =>
        `- Review (${review.status}) ${review.reason}: ${review.summary}${review.reviewerNote ? ` Note: ${review.reviewerNote}` : ""}`,
    ),
    ...context.priorCalls.map((call, index) => {
      const transcript = call.transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join(" / ");
      return `- Prior call ${index + 1} (${call.connectionStatus}): ${transcript || "no transcript"}`;
    }),
  ];

  return [
    `You are placing an outbound phone call to ${context.clientName} about ${context.matterName}.`,
    `You work with ${context.assignedUserName} at HelloCounsel.`,
    context.providerName ? `Medical provider involved: ${context.providerName}.` : "",
    `Client local timezone: ${context.timeZone} (source: ${context.timeZoneSource}).`,
    `Current time for the client: ${formatInTimeZone(now, context.timeZone)}.`,
    "Speak every date and time in the client's local terms. Never mention UTC, GMT, or ISO timestamps.",
    `Workflow: ${context.runTitle}. Status: ${context.runStatus}.`,
    `Latest case summary: ${context.runSummary || "None"}.`,
    "Full history of prior interactions:",
    ...(history.length > 0 ? history : ["- No prior interactions recorded."]),
    "Conduct the conversation autonomously. Decide what to ask and how to follow up from this history and the client's live answers. Do not follow a fixed script.",
    "Identify yourself and the purpose of the call in the first sentence.",
    "If the client names a day or time to call back, repeat it back in their local time so we can schedule it exactly.",
    `When the conversation is complete, append ${END_CALL_MARKER} after your last spoken sentence.`,
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
    messages.push({ role: "user", content: "The client just answered the phone. Give your opening spoken line only." });
  }
  return messages;
}
