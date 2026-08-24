import twilio from "twilio";
import { createOpenAiCompatibleClient, type LlmClient } from "./llm";
import type { PhoneCallConfig, TwilioVoiceClient } from "./types";

export type PhoneRuntimeConfig = PhoneCallConfig & {
  accountSid: string;
  authToken: string;
  llm: {
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
};

export function loadPhoneRuntimeConfig(env: NodeJS.ProcessEnv = process.env): PhoneRuntimeConfig {
  const accountSid = required(env, "TWILIO_ACCOUNT_SID");
  const authToken = required(env, "TWILIO_AUTH_TOKEN");
  const fromNumber = required(env, "TWILIO_FROM_NUMBER");
  const publicBaseUrl = required(env, "PUBLIC_BASE_URL").replace(/\/$/, "");
  const apiKey = env.LLM_API_KEY ?? env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY or OPENAI_API_KEY is required for outbound calls.");
  return {
    accountSid,
    authToken,
    fromNumber,
    publicBaseUrl,
    llm: {
      apiKey,
      model: env.LLM_MODEL ?? "gpt-4.1-mini",
      baseUrl: env.LLM_BASE_URL,
    },
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

export function createCallLlmClient(config: PhoneRuntimeConfig["llm"]): LlmClient {
  return createOpenAiCompatibleClient(config);
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
