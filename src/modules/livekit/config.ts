export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
  inferenceApiKey: string;
  agentName: string;
  sttModel: string;
  llmModel: string;
  ttsModel: string;
  ttsVoice: string;
};

const defaults = {
  agentName: "hellocouncil-agent",
  sttModel: "deepgram/nova-3",
  llmModel: "openai/gpt-4.1-mini",
  ttsModel: "cartesia/sonic-3",
  ttsVoice: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
};

export function getLiveKitConfig(env: NodeJS.ProcessEnv = process.env): LiveKitConfig {
  return {
    url: required(env, "LIVEKIT_URL"),
    apiKey: required(env, "LIVEKIT_API_KEY"),
    apiSecret: required(env, "LIVEKIT_API_SECRET"),
    inferenceApiKey: required(env, "LIVEKIT_INFERENCE_API_KEY"),
    agentName: env.LIVEKIT_AGENT_NAME?.trim() || defaults.agentName,
    sttModel: env.LIVEKIT_STT_MODEL?.trim() || defaults.sttModel,
    llmModel: env.LIVEKIT_LLM_MODEL?.trim() || defaults.llmModel,
    ttsModel: env.LIVEKIT_TTS_MODEL?.trim() || defaults.ttsModel,
    ttsVoice: env.LIVEKIT_TTS_VOICE?.trim() || defaults.ttsVoice,
  };
}

function required(env: NodeJS.ProcessEnv, key: keyof NodeJS.ProcessEnv) {
  const value = env[key];
  if (!value?.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}
