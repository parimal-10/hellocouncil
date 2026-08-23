import { describe, expect, it } from "vitest";
import { getLiveKitConfig } from "@/modules/livekit/config";

describe("LiveKit config", () => {
  it("loads LiveKit-only runtime configuration", () => {
    const config = getLiveKitConfig({
      LIVEKIT_URL: "wss://example.livekit.cloud",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "secret",
      LIVEKIT_INFERENCE_API_KEY: "inference",
      LIVEKIT_AGENT_NAME: "hellocouncil-agent",
      LIVEKIT_STT_MODEL: "deepgram/nova-3",
      LIVEKIT_LLM_MODEL: "openai/gpt-4.1-mini",
      LIVEKIT_TTS_MODEL: "cartesia/sonic-3",
      LIVEKIT_TTS_VOICE: "voice-id",
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({
      url: "wss://example.livekit.cloud",
      apiKey: "key",
      apiSecret: "secret",
      inferenceApiKey: "inference",
      agentName: "hellocouncil-agent",
      sttModel: "deepgram/nova-3",
      llmModel: "openai/gpt-4.1-mini",
      ttsModel: "cartesia/sonic-3",
      ttsVoice: "voice-id",
    });
  });

  it("fails with a direct message when required LiveKit config is missing", () => {
    expect(() => getLiveKitConfig({} as NodeJS.ProcessEnv)).toThrow("LIVEKIT_URL is required");
  });
});
