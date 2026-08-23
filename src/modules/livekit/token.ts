import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import type { LiveKitConfig } from "./config";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";

export type LiveKitTokenStore = {
  createLiveKitSession(input: {
    caseId: string;
    workflowRunId: string;
    roomName: string;
    participantIdentity: string;
    providerSessionId?: string;
  }): Promise<string>;
};

export type LiveKitAgentDispatcher = {
  createDispatch(roomName: string, agentName: string): Promise<{ id: string }>;
};

export function createLiveKitAgentDispatcher(
  config: Pick<LiveKitConfig, "url" | "apiKey" | "apiSecret">,
): LiveKitAgentDispatcher {
  return new AgentDispatchClient(config.url, config.apiKey, config.apiSecret);
}

export function createLiveKitRoomName(input: { workflowRunId: string }) {
  return `workflow-${input.workflowRunId}`;
}

export function createParticipantIdentity(input: { workflowRunId: string }) {
  return `browser-${input.workflowRunId}`;
}

export async function createBrowserVoiceSessionLaunch(input: {
  config: LiveKitConfig;
  store: LiveKitTokenStore;
  dispatcher?: LiveKitAgentDispatcher;
  workflowRunId: string;
  caseId: string;
}): Promise<BrowserVoiceSessionLaunch> {
  const roomName = createLiveKitRoomName({ workflowRunId: input.workflowRunId });
  const participantIdentity = createParticipantIdentity({ workflowRunId: input.workflowRunId });
  const token = new AccessToken(input.config.apiKey, input.config.apiSecret, {
    identity: participantIdentity,
    name: "Firm user",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const dispatcher = input.dispatcher ?? createLiveKitAgentDispatcher(input.config);
  const dispatch = await dispatcher.createDispatch(roomName, input.config.agentName);

  await input.store.createLiveKitSession({
    caseId: input.caseId,
    workflowRunId: input.workflowRunId,
    roomName,
    participantIdentity,
    providerSessionId: dispatch.id,
  });

  return {
    roomName,
    participantIdentity,
    token: await token.toJwt(),
    workflowRunId: input.workflowRunId,
    caseId: input.caseId,
    livekitUrl: input.config.url,
  };
}
