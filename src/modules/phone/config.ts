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
  apiKey?: string;
  apiSecret?: string;
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
  if (accountSid.startsWith("SK")) {
    throw new Error(
      "TWILIO_ACCOUNT_SID must be the Account SID starting with AC. Put the API Key SID in TWILIO_API_KEY and its secret in TWILIO_API_SECRET. Twilio webhook signatures still need the account Auth Token in TWILIO_AUTH_TOKEN.",
    );
  }
  const authToken = required(env, "TWILIO_AUTH_TOKEN");
  const fromNumber = required(env, "TWILIO_FROM_NUMBER");
  const publicBaseUrl = required(env, "PUBLIC_BASE_URL").replace(/\/$/, "");
  const apiKey = env.TWILIO_API_KEY?.trim();
  const apiSecret = env.TWILIO_API_SECRET?.trim();
  return {
    accountSid,
    authToken,
    apiKey: apiKey || undefined,
    apiSecret: apiSecret || undefined,
    fromNumber,
    publicBaseUrl,
    llm: resolveLlmConfig(env),
  };
}

export function createTwilioVoiceClient(
  config: Pick<PhoneRuntimeConfig, "accountSid" | "authToken" | "apiKey" | "apiSecret">,
): TwilioVoiceClient {
  const client =
    config.apiKey && config.apiSecret
      ? twilio(config.apiKey, config.apiSecret, { accountSid: config.accountSid })
      : twilio(config.accountSid, config.authToken);
  return {
    async createCall(input) {
      const call = await client.calls.create(twilioCallCreateParams(input));
      return { sid: call.sid, status: call.status };
    },
  };
}

export function twilioCallCreateParams(input: {
  to: string;
  from: string;
  url: string;
  statusCallback: string;
}) {
  return {
    to: input.to,
    from: input.from,
    url: input.url,
    statusCallback: input.statusCallback,
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
  return twilioWebhookUrlCandidates(request, publicBaseUrl)[0];
}

export function twilioWebhookUrlCandidates(request: Request, publicBaseUrl: string): string[] {
  const incoming = new URL(request.url);
  const pathWithQuery = `${incoming.pathname}${incoming.search}`;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const urls = [`${publicBaseUrl.replace(/\/$/, "")}${pathWithQuery}`];
  if (proto && host) {
    urls.push(`${proto}://${host}${pathWithQuery}`);
  }
  urls.push(incoming.href);
  return [...new Set(urls)];
}

export function authorizeTwilioWebhook(input: {
  authToken: string;
  apiSecret?: string;
  accountSid: string;
  signature: string | null;
  userAgent: string | null;
  urls: string[];
  params: Record<string, string>;
}): boolean {
  if (input.signature) {
    return validateTwilioSignature({
      authToken: input.authToken,
      apiSecret: input.apiSecret,
      signature: input.signature,
      url: input.urls[0] ?? "",
      urls: input.urls,
      params: input.params,
    });
  }
  return isUnsignedTrialVoiceFetch(input);
}

export function isUnsignedTrialVoiceFetch(input: {
  accountSid: string;
  userAgent: string | null;
  params: Record<string, string>;
}): boolean {
  const agent = input.userAgent ?? "";
  return (
    agent.includes("Java-http-client") &&
    input.params.AccountSid === input.accountSid &&
    Boolean(input.params.CallSid)
  );
}

export function validateTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
  urls?: string[];
  apiSecret?: string;
}): boolean {
  if (!input.signature) return false;
  const urls = input.urls?.length ? input.urls : [input.url];
  const tokens = [input.authToken, input.apiSecret].filter((token): token is string => Boolean(token));
  return tokens.some((token) => urls.some((url) => twilio.validateRequest(token, input.signature!, url, input.params)));
}

export async function readTwilioForm(request: Request): Promise<Record<string, string>> {
  const raw = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw).entries()) {
    params[key] = value;
  }
  return params;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for outbound calling.`);
  return value;
}
