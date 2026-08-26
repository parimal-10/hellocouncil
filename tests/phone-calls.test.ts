import { describe, expect, it } from "vitest";
import { handleCallStatus, handleCallTurn, handleCallVoice, placeOutboundCall } from "@/modules/phone/service";
import type { LlmClient } from "@/modules/phone/llm";
import type { OutboundCallContext, PhoneCallRecord, TwilioVoiceClient } from "@/modules/phone/types";
import { MemoryPhoneCallStore } from "./phone-test-store";

const chicagoMondayAfternoon = new Date("2026-08-24T17:00:00.000Z");

function context(overrides: Partial<OutboundCallContext> = {}): OutboundCallContext {
  return {
    caseId: "case-1",
    workflowRunId: "run-1",
    definitionId: "client-check-in",
    matterName: "Lee v. Metro Transit",
    clientName: "Jordan Lee",
    clientPhone: "+13125550101",
    timeZone: "America/Chicago",
    timeZoneSource: "explicit",
    assignedUserName: "Maya Singh",
    providerName: "Northside Imaging",
    runTitle: "Northside Imaging records follow-up",
    runStatus: "active",
    runSummary: "Harbor confirmed the request is in queue.",
    events: [
      { type: "workflow.started", summary: "Follow-up started.", occurredAt: new Date("2026-08-20T12:00:00.000Z") },
      { type: "contact.attempted", summary: "Left a message last Thursday.", occurredAt: new Date("2026-08-21T16:00:00.000Z") },
    ],
    attempts: [{ channel: "phone", outcome: "left_message", summary: "Left a message last Thursday.", attemptedAt: new Date("2026-08-21T16:00:00.000Z") }],
    reviews: [],
    priorCalls: [],
    ...overrides,
  };
}

function scriptedLlm(replies: string[]): LlmClient {
  const queue = [...replies];
  return {
    async complete() {
      const reply = queue.shift();
      if (!reply) throw new Error("LLM script exhausted");
      return reply;
    },
  };
}

function twilioStub(calls: Array<Record<string, unknown>> = []): TwilioVoiceClient {
  return {
    async createCall(input) {
      calls.push(input);
      return { sid: "CA123", status: "queued" };
    },
  };
}

describe("placeOutboundCall", () => {
  it("dials the client number after loading case history, without scheduling a follow-up", async () => {
    const store = new MemoryPhoneCallStore();
    const created: Array<Record<string, unknown>> = [];
    const result = await placeOutboundCall({
      context: context(),
      now: chicagoMondayAfternoon,
      store,
      twilio: twilioStub(created),
      config: {
        fromNumber: "+15551234567",
        publicBaseUrl: "https://example.test",
      },
    });

    expect(result.call.twilioCallSid).toBe("CA123");
    expect(result.call.toNumber).toBe("+13125550101");
    expect(result.call.timeZone).toBe("America/Chicago");
    expect(result.call.connectionStatus).toBe("initiated");
    expect(created[0]).toMatchObject({
      to: "+13125550101",
      from: "+15551234567",
    });
    expect(created[0]).not.toHaveProperty("machineDetection");
    expect(created[0]).not.toHaveProperty("statusCallbackEvent");
    expect(String(created[0]?.url)).toContain("/api/twilio/voice?callId=");
    expect(String(created[0]?.statusCallback)).toContain("/api/twilio/status?callId=");
    expect(store.scheduledFollowUps).toHaveLength(0);
    expect(result.compliance.blocked).toBe(false);
  });

  it("dials the provider number for a medical-records follow-up", async () => {
    const store = new MemoryPhoneCallStore();
    const created: Array<Record<string, unknown>> = [];
    const result = await placeOutboundCall({
      context: context({
        definitionId: "medical-records-follow-up",
        providerName: "Harbor Orthopedics",
        providerPhone: "+12125550199",
        runTitle: "Harbor Orthopedics records follow-up",
      }),
      now: chicagoMondayAfternoon,
      store,
      twilio: twilioStub(created),
      config: { fromNumber: "+15551234567", publicBaseUrl: "https://example.test" },
      stepType: "provider_follow_up",
    });

    expect(result.call.toNumber).toBe("+12125550199");
    expect(created[0]).toMatchObject({ to: "+12125550199" });
    expect(result.call.briefing).toMatch(/Harbor Orthopedics/);
    expect(result.call.briefing).toMatch(/records desk/);
  });

  it("refuses to dial when the case has no phone number", async () => {
    const store = new MemoryPhoneCallStore();
    await expect(
      placeOutboundCall({
        context: context({ clientPhone: "" }),
        now: chicagoMondayAfternoon,
        store,
        twilio: twilioStub(),
        config: { fromNumber: "+15551234567", publicBaseUrl: "https://example.test" },
      }),
    ).rejects.toThrow(/phone number/i);
    expect(store.calls).toHaveLength(0);
  });
});

describe("call voice and turns", () => {
  it("leaves a short voicemail when AMD reports a machine, without starting a conversation", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store);
    const llm: LlmClient = {
      async complete() {
        throw new Error("LLM should not be called for voicemail");
      },
    };
    const twiml = await handleCallVoice({
      callId: call.id,
      answeredBy: "machine_start",
      store,
      llm,
      now: chicagoMondayAfternoon,
      publicBaseUrl: "https://example.test",
    });

    expect(twiml).toMatch(/<Say\b/);
    expect(twiml).toMatch(/<Hangup/);
    expect(store.calls[0]?.connectionStatus).toBe("voicemail");
    expect(store.calls[0]?.transcript).toHaveLength(1);
  });

  it("greets a live answer immediately without waiting on the LLM", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store);
    const twiml = await handleCallVoice({
      callId: call.id,
      answeredBy: "human",
      store,
      llm: {
        async complete() {
          throw new Error("LLM should not be called for the opening TwiML");
        },
      },
      now: chicagoMondayAfternoon,
      publicBaseUrl: "https://example.test",
    });

    expect(store.calls[0]?.connectionStatus).toBe("answered");
    expect(store.calls[0]?.transcript[0]).toMatchObject({
      speaker: "agent",
      text: "Hello, this is HelloCounsel calling about your case. How are you today?",
    });
    expect(twiml).toContain("<Gather");
    expect(twiml).toContain("input=\"speech\"");
    expect(twiml).toContain("HelloCounsel");
    expect(twiml).toContain(`https://example.test/api/twilio/voice?callId=${call.id}`);
  });

  it("lets the model follow the client instead of a fixed script, then hangs up on END_CALL", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store, { connectionStatus: "answered" });
    await handleCallTurn({
      callId: call.id,
      speech: "The records are already at my attorney's office. You can close this out.",
      store,
      llm: scriptedLlm(["Thanks Jordan, I will note that the records arrived. [[END_CALL]]"]),
      now: chicagoMondayAfternoon,
      publicBaseUrl: "https://example.test",
    });

    const saved = store.calls[0];
    expect(saved?.transcript.map((turn) => turn.speaker)).toEqual(["client", "agent"]);
    expect(saved?.transcript[0]?.text).toContain("records are already");
  });

  it("reprompts once when Twilio captures no speech after the opening prompt", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store, {
      connectionStatus: "answered",
      transcript: [
        {
          speaker: "agent",
          text: "Hello, this is HelloCounsel calling about your case. How are you today?",
          occurredAt: chicagoMondayAfternoon,
        },
      ],
    });
    const twiml = await handleCallTurn({
      callId: call.id,
      speech: "",
      store,
      llm: {
        async complete() {
          throw new Error("LLM should not be called for the first no-speech reprompt");
        },
      },
      now: chicagoMondayAfternoon,
      publicBaseUrl: "https://example.test",
    });

    expect(twiml).toContain("<Gather");
    expect(twiml).not.toContain("<Hangup");
    expect(store.calls[0]?.transcript.map((turn) => turn.speaker)).toEqual(["agent", "agent"]);
    expect(store.calls[0]?.transcript[1]?.text).toMatch(/HelloCounsel calling/i);
  });

  it("uses a records-desk reprompt for silent provider follow-up calls", async () => {
    const store = new MemoryPhoneCallStore();
    const result = await placeOutboundCall({
      context: context({
        definitionId: "medical-records-follow-up",
        providerPhone: "+12125550199",
      }),
      now: chicagoMondayAfternoon,
      store,
      twilio: twilioStub(),
      config: { fromNumber: "+15551234567", publicBaseUrl: "https://example.test" },
      stepType: "provider_follow_up",
    });
    await store.updateCall(result.call.id, {
      connectionStatus: "answered",
      transcript: [
        {
          speaker: "agent",
          text: "Hello, this is HelloCounsel calling about your case. How are you today?",
          occurredAt: chicagoMondayAfternoon,
        },
      ],
    });
    const twiml = await handleCallTurn({
      callId: result.call.id,
      speech: undefined,
      store,
      llm: {
        async complete() {
          throw new Error("LLM should not be called for the first no-speech reprompt");
        },
      },
      now: chicagoMondayAfternoon,
      publicBaseUrl: "https://example.test",
    });

    expect(twiml).toContain("<Gather");
    expect(store.calls[0]?.transcript[1]?.text).toMatch(/medical records request/i);
    expect(store.calls[0]?.transcript[1]?.text).toMatch(/records desk/i);
  });
});

describe("status callbacks and outcomes", () => {
  it("persists Twilio's terminal status instead of inferring it from the transcript", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store);
    await handleCallStatus({
      callId: call.id,
      callStatus: "no-answer",
      store,
      llm: scriptedLlm([]),
      now: chicagoMondayAfternoon,
    });
    expect(store.calls[0]?.connectionStatus).toBe("no-answer");
    expect(store.contactAttempts[0]).toMatchObject({
      channel: "phone",
      outcome: "failed",
    });
    expect(store.calls[0]?.structuredOutcome).toBeNull();
  });

  it("extracts a callback request in the client's timezone after a completed conversation", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store, {
      connectionStatus: "answered",
      transcript: [
        { speaker: "agent", text: "When should we call you back?", occurredAt: chicagoMondayAfternoon },
        { speaker: "client", text: "Call me Tuesday at 3pm.", occurredAt: chicagoMondayAfternoon },
        { speaker: "agent", text: "Tuesday at 3:00 PM Central Time works. [[END_CALL]]", occurredAt: chicagoMondayAfternoon },
      ],
    });
    const llm = scriptedLlm([
      JSON.stringify({
        newInformation: ["Client asked for a callback Tuesday at 3pm."],
        requestedCallback: "Tuesday at 3pm",
        status: "callback requested",
        sentiment: "neutral",
        shouldContinueOutreach: true,
      }),
    ]);

    await handleCallStatus({
      callId: call.id,
      callStatus: "completed",
      answeredBy: "human",
      store,
      llm,
      now: chicagoMondayAfternoon,
    });

    const outcome = store.calls[0]?.structuredOutcome;
    expect(outcome?.requestedCallbackAt).toBe("2026-08-25T20:00:00.000Z");
    expect(outcome?.requestedCallbackLocal).toContain("3:00 PM");
    expect(outcome?.requestedCallbackLocal).not.toMatch(/UTC/);
    expect(store.runSummaries.get("run-1")).toContain("callback requested");
    expect(store.events.some((event) => event.type === "phone_call.completed")).toBe(true);
    expect(store.contactAttempts[0]?.outcome).toBe("reached");
  });

  it("extracts a short relative callback request instead of falling back to the workflow default", async () => {
    const store = new MemoryPhoneCallStore();
    const call = await seedCall(store, {
      connectionStatus: "answered",
      transcript: [
        { speaker: "agent", text: "When should we call you back?", occurredAt: chicagoMondayAfternoon },
        { speaker: "client", text: "Can you call me in 1 min?", occurredAt: chicagoMondayAfternoon },
        { speaker: "agent", text: "I will call you back in one minute. [[END_CALL]]", occurredAt: chicagoMondayAfternoon },
      ],
    });
    const llm = scriptedLlm([
      JSON.stringify({
        newInformation: ["Provider asked for a callback in 1 min."],
        requestedCallback: "in 1 min",
        status: "callback requested",
        sentiment: "neutral",
        shouldContinueOutreach: true,
      }),
    ]);

    await handleCallStatus({
      callId: call.id,
      callStatus: "completed",
      answeredBy: "human",
      store,
      llm,
      now: chicagoMondayAfternoon,
    });

    const outcome = store.calls[0]?.structuredOutcome;
    expect(outcome?.requestedCallbackAt).toBe("2026-08-24T17:01:00.000Z");
    expect(outcome?.requestedCallbackLocal).toContain("12:01 PM");
  });
});

async function seedCall(store: MemoryPhoneCallStore, patch: Partial<PhoneCallRecord> = {}) {
  const result = await placeOutboundCall({
    context: context(),
    now: chicagoMondayAfternoon,
    store,
    twilio: twilioStub(),
    config: { fromNumber: "+15551234567", publicBaseUrl: "https://example.test" },
  });
  if (Object.keys(patch).length > 0) {
    await store.updateCall(result.call.id, patch);
  }
  return store.calls[0]!;
}
