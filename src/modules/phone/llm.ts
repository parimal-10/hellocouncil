export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmClient = {
  complete(messages: ChatMessage[]): Promise<string>;
};

export type LlmAuth = "bearer" | "livekit-jwt";

export type LlmClientOptions = {
  apiKey: string;
  apiSecret?: string;
  model: string;
  baseUrl?: string;
  auth?: LlmAuth;
};

export type LlmClientHooks = {
  createAccessToken?: (apiKey: string, apiSecret: string) => Promise<string>;
  fetch?: typeof fetch;
};

const LIVEKIT_INFERENCE_URL = "https://agent-gateway.livekit.cloud/v1";

export function createOpenAiCompatibleClient(
  input: LlmClientOptions,
  hooks: LlmClientHooks = {},
): LlmClient {
  const request = hooks.fetch ?? fetch;
  return {
    async complete(messages) {
      const token = await resolveAccessToken(input, hooks);
      const response = await request(`${input.baseUrl ?? defaultBaseUrl(input.auth)}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          temperature: 0.4,
        }),
      });
      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`);
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("LLM returned an empty reply.");
      return content;
    },
  };
}

export async function mintLiveKitInferenceToken(apiKey: string, apiSecret: string): Promise<string> {
  const { AccessToken } = await import("livekit-server-sdk");
  const token = new AccessToken(apiKey, apiSecret, { identity: "phone-agent", ttl: 600 });
  token.addInferenceGrant({ perform: true });
  return token.toJwt();
}

export function liveKitInferenceUrl(envUrl?: string): string {
  return (envUrl?.trim() || LIVEKIT_INFERENCE_URL).replace(/\/$/, "");
}

function defaultBaseUrl(auth?: LlmAuth): string {
  return auth === "livekit-jwt" ? LIVEKIT_INFERENCE_URL : "https://api.openai.com/v1";
}

async function resolveAccessToken(input: LlmClientOptions, hooks: LlmClientHooks): Promise<string> {
  if (input.auth !== "livekit-jwt") return input.apiKey;
  if (!input.apiSecret) throw new Error("LIVEKIT_API_SECRET is required for LiveKit Inference.");
  const mint = hooks.createAccessToken ?? mintLiveKitInferenceToken;
  return mint(input.apiKey, input.apiSecret);
}
