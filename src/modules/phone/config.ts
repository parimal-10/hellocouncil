import twilio from "twilio";
import {
  createOpenAiCompatibleClient,
  liveKitInferenceUrl,
  type LlmAuth,
  type LlmClient,
  type LlmClientHooks,
} from "./llm";
import type { PhoneCallConfig, TwilioVoiceClient } from "./types";

export type PhoneRuntimeConfig = PhoneCallConfig & {
  accountSid: string;
  authToken: string;
  llm: {
    apiKey: string;
    apiSecret?: string;
    model: string;
    baseUrl: string;
    auth: LlmAuth;
  };
};

export function loadPhoneRuntimeConfig(env: NodeJS.ProcessEnv = process.env): PhoneRuntimeConfig {
  const accountSid = required(env, "TWILIO_ACCOUNT_SID");
  const authToken = required(env, "TWILIO_AUTH_TOKEN");
  const fromNumber = required(env, "TWILIO_FROM_NUMBER");
  const publicBaseUrl = required(env, "PUBLIC_BASE_URL").replace(/\/$/, "");
  return {
    accountSid,
    authToken,
    fromNumber,
    publicBaseUrl,
    llm: resolveLlmConfig(env),
  };
}

export function createTwilioVoiceClient(config: Pick<PhoneRuntimeConfig, "accountSid" | "authToken">): TwilioVoiceClient {
  const client = twilio(config.accountSid, config.authToken);
  return {
    async createCall(input) {
      const call = await client.calls.create({
        to: input.to,
        from: input.from,
        url: input.url,
        statusCallback: input.statusCallback,
        statusCallbackEvent: input.statusCallbackEvent,
        statusCallbackMethod: "POST",
        machineDetection: input.machineDetection,
      });
      return { sid: call.sid, status: call.status };
    },
  };
}

export function createCallLlmClient(config: PhoneRuntimeConfig["llm"], hooks?: LlmClientHooks): LlmClient {
  return createOpenAiCompatibleClient(config, hooks);
}

function resolveLlmConfig(env: NodeJS.ProcessEnv): PhoneRuntimeConfig["llm"] {
  const livekitKey = env.LIVEKIT_INFERENCE_API_KEY?.trim() || env.LIVEKIT_API_KEY?.trim();
  const livekitSecret = env.LIVEKIT_INFERENCE_API_SECRET?.trim() || env.LIVEKIT_API_SECRET?.trim();
  if (livekitKey && livekitSecret) {
    return {
      apiKey: livekitKey,
      apiSecret: livekitSecret,
      model: env.LLM_MODEL?.trim() || env.LIVEKIT_LLM_MODEL?.trim() || "openai/gpt-4.1-mini",
      baseUrl: liveKitInferenceUrl(env.LLM_BASE_URL ?? env.LIVEKIT_INFERENCE_URL),
      auth: "livekit-jwt",
    };
  }

  const openaiKey = env.LLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      model: env.LLM_MODEL?.trim() || "gpt-4.1-mini",
      baseUrl: (env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
      auth: "bearer",
    };
  }

  throw new Error(
    "LIVEKIT_INFERENCE_API_KEY and LIVEKIT_API_SECRET are required for outbound calls (or set OPENAI_API_KEY).",
  );
}

export function twilioWebhookUrl(request: Request, publicBaseUrl: string): string {
  const incoming = new URL(request.url);
  return `${publicBaseUrl.replace(/\/$/, "")}${incoming.pathname}${incoming.search}`;
}

export function validateTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signature) return false;
  return twilio.validateRequest(input.authToken, input.signature, input.url, input.params);
}

export async function readTwilioForm(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for outbound calling.`);
  return value;
}
