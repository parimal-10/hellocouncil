import { describe, expect, it } from "vitest";
import { createCallLlmClient, loadPhoneRuntimeConfig } from "@/modules/phone/config";

const twilioEnv = {
  TWILIO_ACCOUNT_SID: "ACxxx",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_FROM_NUMBER: "+15551234567",
  PUBLIC_BASE_URL: "https://example.test",
};

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
