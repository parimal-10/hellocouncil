import { buildCallBriefing, conversationMessages, hasEndCallMarker, stripEndCallMarker } from "./conversation";
import { evaluateOutboundCallCompliance } from "./compliance";
import { resolveOutboundCallee } from "./callee";
import type { ChatMessage, LlmClient } from "./llm";
import { extractCallOutcome } from "./outcomes";
import { toE164 } from "./phone-number";
import { contactOutcomeFor, connectionStatusFromTwilio, isMachine, isTerminalConnectionStatus } from "./status";
import { sayAndGather, sayAndHangup } from "./twiml";
import type {
  ConnectionStatus,
  OutboundCallContext,
  PhoneCallConfig,
  PhoneCallRecord,
  PhoneCallStore,
  TwilioVoiceClient,
} from "./types";

const VOICEMAIL_MESSAGE =
  "Hello, this is HelloCounsel calling about your case. We will try you again later. Goodbye.";
const OPENING_MESSAGE = "Hello, this is HelloCounsel calling about your case. How are you today?";

export async function placeOutboundCall(input: {
  context: OutboundCallContext;
  now: Date;
  store: PhoneCallStore;
  twilio: TwilioVoiceClient;
  config: PhoneCallConfig;
  consentRecorded?: boolean;
  onDoNotCallList?: boolean;
  workflowStepId?: string | null;
  stepType?: string | null;
}): Promise<{ call: PhoneCallRecord; compliance: ReturnType<typeof evaluateOutboundCallCompliance> }> {
  const callee = resolveOutboundCallee(input.context, input.stepType);
  const toNumber = toE164(callee.phone);
  if (!toNumber) {
    throw new Error(`No dialable phone number for ${callee.name}.`);
  }

  const compliance = evaluateOutboundCallCompliance({
    timeZone: input.context.timeZone,
    now: input.now,
    consentRecorded: input.consentRecorded ?? false,
    onDoNotCallList: input.onDoNotCallList ?? false,
  });

  const call = await input.store.createCall({
    caseId: input.context.caseId,
    workflowRunId: input.context.workflowRunId,
    workflowStepId: input.workflowStepId ?? null,
    voiceSessionId: null,
    contactAttemptId: null,
    twilioCallSid: null,
    toNumber,
    fromNumber: input.config.fromNumber,
    timeZone: input.context.timeZone,
    briefing: buildCallBriefing(input.context, input.now, input.stepType),
    connectionStatus: "initiated",
    twilioCallStatus: "queued",
    answeredBy: null,
    transcript: [],
    structuredOutcome: null,
    complianceFlags: compliance.flags,
    orchestrationAppliedAt: null,
    completedAt: null,
  });

  const placed = await input.twilio.createCall({
    to: toNumber,
    from: input.config.fromNumber,
    url: `${input.config.publicBaseUrl}/api/twilio/voice?callId=${call.id}`,
    statusCallback: `${input.config.publicBaseUrl}/api/twilio/status?callId=${call.id}`,
  });

  const updated = await input.store.updateCall(call.id, {
    twilioCallSid: placed.sid,
    twilioCallStatus: placed.status,
  });

  await input.store.appendWorkflowEvent({
    workflowRunId: input.context.workflowRunId,
    type: "phone_call.initiated",
    summary: `Outbound call placed to ${callee.name}.`,
    payload: { callId: call.id, twilioCallSid: placed.sid, complianceFlags: compliance.flags },
  });

  return { call: updated, compliance };
}

export async function handleCallVoice(input: {
  callId: string;
  answeredBy?: string | null;
  store: PhoneCallStore;
  llm: LlmClient;
  now: Date;
  publicBaseUrl: string;
}): Promise<string> {
  const call = await requireCall(input.store, input.callId);
  const connectionStatus = connectionStatusFromTwilio({
    callStatus: "in-progress",
    answeredBy: input.answeredBy,
    previous: call.connectionStatus,
  });
  await input.store.updateCall(call.id, {
    connectionStatus,
    answeredBy: input.answeredBy ?? call.answeredBy,
    twilioCallStatus: "in-progress",
  });

  if (isMachine(input.answeredBy) || connectionStatus === "voicemail") {
    await input.store.appendTranscript(call.id, {
      speaker: "agent",
      text: VOICEMAIL_MESSAGE,
      occurredAt: input.now,
    });
    await finalizeAttempt(input.store, { ...call, connectionStatus: "voicemail" }, "voicemail");
    return sayAndHangup(VOICEMAIL_MESSAGE);
  }

  const spoken = OPENING_MESSAGE;
  await input.store.appendTranscript(call.id, { speaker: "agent", text: spoken, occurredAt: input.now });
  return sayAndGather({
    text: spoken,
    action: followUpAction(input.publicBaseUrl, call.id),
  });
}

export async function handleCallTurn(input: {
  callId: string;
  speech?: string | null;
  store: PhoneCallStore;
  llm: LlmClient;
  now: Date;
  publicBaseUrl: string;
}): Promise<string> {
  const call = await requireCall(input.store, input.callId);
  const speech = input.speech?.trim();
  let current = call;
  if (speech) {
    current = await input.store.appendTranscript(call.id, {
      speaker: "client",
      text: speech,
      occurredAt: input.now,
    });
  }

  const reply = await completeSpokenReply(
    input.llm,
    conversationMessages(current, speech ? undefined : "The client was silent. Prompt briefly or end the call."),
  );
  const spoken = stripEndCallMarker(reply) || "Thank you. Goodbye.";
  await input.store.appendTranscript(call.id, { speaker: "agent", text: spoken, occurredAt: input.now });
  if (hasEndCallMarker(reply) || !speech) return sayAndHangup(spoken);
  return sayAndGather({
    text: spoken,
    action: followUpAction(input.publicBaseUrl, call.id),
  });
}

export async function handleCallStatus(input: {
  callId: string;
  callStatus: string;
  answeredBy?: string | null;
  store: PhoneCallStore;
  llm: LlmClient;
  now: Date;
}): Promise<PhoneCallRecord> {
  const call = await requireCall(input.store, input.callId);
  const connectionStatus = connectionStatusFromTwilio({
    callStatus: input.callStatus,
    answeredBy: input.answeredBy ?? call.answeredBy,
    previous: call.connectionStatus,
  });
  const terminal = isTerminalStatusCallback(input.callStatus);
  let updated = await input.store.updateCall(call.id, {
    connectionStatus,
    twilioCallStatus: input.callStatus,
    answeredBy: input.answeredBy ?? call.answeredBy,
    completedAt: terminal ? input.now : call.completedAt,
  });

  if (shouldExtractOutcome(updated, input.callStatus)) {
    const structuredOutcome = await extractCallOutcome({ call: updated, llm: input.llm, now: input.now });
    const summary = outcomeSummary(updated, structuredOutcome.status, structuredOutcome.newInformation);
    updated = await input.store.updateCall(call.id, { structuredOutcome });
    await input.store.updateRunSummary(updated.workflowRunId, summary);
    await input.store.appendWorkflowEvent({
      workflowRunId: updated.workflowRunId,
      type: "phone_call.completed",
      summary,
      payload: { callId: updated.id, connectionStatus: updated.connectionStatus, structuredOutcome },
    });
  }

  await finalizeAttempt(input.store, updated, connectionStatus);
  return updated;
}

function isTerminalStatusCallback(callStatus: string): boolean {
  return callStatus === "completed" || callStatus === "busy" || callStatus === "no-answer" || callStatus === "failed" || callStatus === "canceled";
}

function shouldExtractOutcome(call: PhoneCallRecord, callStatus: string): boolean {
  return callStatus === "completed" && call.transcript.length > 0 && !call.structuredOutcome;
}

async function finalizeAttempt(store: PhoneCallStore, call: PhoneCallRecord, status: ConnectionStatus) {
  if (call.contactAttemptId) return;
  const outcome = contactOutcomeFor(status);
  if (!outcome || !isTerminalConnectionStatus(status)) return;
  if (status === "answered" && call.twilioCallStatus !== "completed") return;

  const attemptId = await store.recordContactAttempt({
    workflowRunId: call.workflowRunId,
    workflowStepId: call.workflowStepId ?? undefined,
    channel: "phone",
    outcome,
    summary: `Twilio call ${status}${call.structuredOutcome?.status ? `: ${call.structuredOutcome.status}` : ""}`.trim(),
  });
  await store.updateCall(call.id, { contactAttemptId: attemptId });
}

async function requireCall(store: PhoneCallStore, callId: string): Promise<PhoneCallRecord> {
  const call = await store.getCall(callId);
  if (!call) throw new Error(`Phone call not found: ${callId}`);
  return call;
}

function followUpAction(publicBaseUrl: string, callId: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/api/twilio/voice?callId=${callId}`;
}

async function completeSpokenReply(llm: LlmClient, messages: ChatMessage[]): Promise<string> {
  const fallback = "Sorry, I did not catch that. Could you say that again?";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      llm.complete(messages),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 3500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function outcomeSummary(
  call: PhoneCallRecord,
  status: string,
  newInformation: string[],
): string {
  const details = newInformation.slice(0, 2).join(" ");
  return `Outbound call ${call.connectionStatus}: ${status}${details ? `. ${details}` : ""}`;
}
