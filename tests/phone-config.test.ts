import twilio from "twilio";
import { describe, expect, it } from "vitest";
import {
  authorizeTwilioWebhook,
  createCallLlmClient,
  loadPhoneRuntimeConfig,
  readTwilioForm,
  twilioCallCreateParams,
  twilioWebhookUrlCandidates,
  validateTwilioSignature,
} from "@/modules/phone/config";

const twilioEnv = {
  TWILIO_ACCOUNT_SID: "ACxxx",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_FROM_NUMBER: "+15551234567",
  PUBLIC_BASE_URL: "https://example.test",
};

describe("Twilio webhook signatures", () => {
  it("keeps empty Twilio fields so the signed body still matches", async () => {
    const request = new Request("http://localhost:3000/api/twilio/voice?callId=abc", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "CallSid=CA123&FromCity=&CallStatus=ringing",
    });
    await expect(readTwilioForm(request)).resolves.toEqual({
      CallSid: "CA123",
      FromCity: "",
      CallStatus: "ringing",
    });
  });

  it("accepts a signature computed against the public ngrok URL when Next.js sees localhost", () => {
    const authToken = "token";
    const publicUrl = "https://example.ngrok-free.app/api/twilio/voice?callId=abc";
    const params = { CallSid: "CA123", FromCity: "", CallStatus: "ringing" };
    const signature = twilio.getExpectedTwilioSignature(authToken, publicUrl, params);
    const request = new Request("http://localhost:3000/api/twilio/voice?callId=abc", {
      method: "POST",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "example.ngrok-free.app",
      },
    });
    const urls = twilioWebhookUrlCandidates(request, "https://example.ngrok-free.app");
    expect(urls).toContain(publicUrl);
    expect(
      validateTwilioSignature({
        authToken,
        signature,
        url: urls[0],
        urls,
        params,
      }),
    ).toBe(true);
    expect(
      validateTwilioSignature({
        authToken,
        signature,
        url: publicUrl,
        params: { CallSid: "CA123", CallStatus: "ringing" },
      }),
    ).toBe(false);
  });

  it("accepts Twilio trial Voice fetches that omit X-Twilio-Signature", () => {
    expect(
      authorizeTwilioWebhook({
        authToken: "token",
        accountSid: "ACxxx",
        signature: null,
        userAgent: "Java-http-client/25.0.2",
        urls: ["https://example.ngrok-free.app/api/twilio/voice?callId=abc"],
        params: { AccountSid: "ACxxx", CallSid: "CA123" },
      }),
    ).toBe(true);
  });

  it("rejects unsigned fetches that are not the trial Voice client", () => {
    expect(
      authorizeTwilioWebhook({
        authToken: "token",
        accountSid: "ACxxx",
        signature: null,
        userAgent: "curl/8.0",
        urls: ["https://example.test/api/twilio/voice"],
        params: { AccountSid: "ACxxx", CallSid: "CA123" },
      }),
    ).toBe(false);
  });
});

describe("Twilio create-call params", () => {
  it("omits trial-blocked AMD and status-callback event fields", () => {
    const params = twilioCallCreateParams({
      to: "+13125550101",
      from: "+15551234567",
      url: "https://example.test/api/twilio/voice?callId=1",
      statusCallback: "https://example.test/api/twilio/status?callId=1",
    });
    expect(params).toEqual({
      to: "+13125550101",
      from: "+15551234567",
      url: "https://example.test/api/twilio/voice?callId=1",
      statusCallback: "https://example.test/api/twilio/status?callId=1",
    });
  });
});

describe("Twilio credentials", () => {
  it("rejects an API Key SID in TWILIO_ACCOUNT_SID", () => {
    expect(() =>
      loadPhoneRuntimeConfig({
        ...twilioEnv,
        TWILIO_ACCOUNT_SID: "SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        LIVEKIT_INFERENCE_API_KEY: "APIinference",
        LIVEKIT_API_SECRET: "livekit-secret",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Account SID starting with AC/);
  });
});

describe("phone runtime LLM config", () => {
  it("uses LiveKit Inference credentials without an OpenAI key", () => {
    const config = loadPhoneRuntimeConfig({
      ...twilioEnv,
      LIVEKIT_INFERENCE_API_KEY: "APIinference",
      LIVEKIT_API_SECRET: "livekit-secret",
      LIVEKIT_LLM_MODEL: "openai/gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    expect(config.llm).toEqual({
      apiKey: "APIinference",
      apiSecret: "livekit-secret",
      model: "openai/gpt-4.1-mini",
      baseUrl: "https://agent-gateway.livekit.cloud/v1",
      auth: "livekit-jwt",
    });
  });

  it("fails clearly when neither LiveKit nor an OpenAI-compatible key is set", () => {
    expect(() => loadPhoneRuntimeConfig(twilioEnv as NodeJS.ProcessEnv)).toThrow(
      /LIVEKIT_INFERENCE_API_KEY/,
    );
  });
});

describe("LiveKit inference chat client", () => {
  it("calls the LiveKit gateway with a minted inference JWT", async () => {
    const config = loadPhoneRuntimeConfig({
      ...twilioEnv,
      LIVEKIT_INFERENCE_API_KEY: "APIinference",
      LIVEKIT_API_SECRET: "livekit-secret",
      LIVEKIT_LLM_MODEL: "openai/gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    const fetches: Array<{ url: string; authorization: string | null; body: { model?: string } }> = [];
    const llm = createCallLlmClient(config.llm, {
      createAccessToken: async () => "lk-jwt",
      fetch: async (url, init) => {
        fetches.push({
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
          body: JSON.parse(String(init?.body)) as { model?: string },
        });
        return new Response(JSON.stringify({ choices: [{ message: { content: "Hi Jordan." } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(llm.complete([{ role: "user", content: "The client answered." }])).resolves.toBe(
      "Hi Jordan.",
    );
    expect(fetches[0]).toMatchObject({
      url: "https://agent-gateway.livekit.cloud/v1/chat/completions",
      authorization: "Bearer lk-jwt",
      body: { model: "openai/gpt-4.1-mini" },
    });
  });
});
