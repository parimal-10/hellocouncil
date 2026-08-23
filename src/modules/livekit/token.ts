import { randomUUID } from "node:crypto";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";
import type { LiveKitConfig } from "./config";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";

export type LiveKitTokenStore = {
  createLiveKitSession(input: {
    caseId: string;
    workflowRunId: string;
    launchId: string;
    roomName: string;
    participantIdentity: string;
    providerSessionId?: string;
  }): Promise<string>;
  updateLiveKitSessionProviderSessionId(
    voiceSessionId: string,
    providerSessionId: string,
  ): Promise<void>;
  finalizeLiveKitSession(
    voiceSessionId: string,
    status: "completed" | "failed",
    endedReason: string,
  ): Promise<boolean>;
  appendSessionEvent(input: {
    voiceSessionId: string;
    type: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void>;
};

export type LiveKitAgentDispatcher = {
  createDispatch(
    roomName: string,
    agentName: string,
    options: { metadata: string },
  ): Promise<{ id: string }>;
  deleteDispatch(dispatchId: string, roomName: string): Promise<void>;
};

export type LiveKitDispatchMetadata = {
  version: 1;
  voiceSessionId: string;
  launchId: string;
  roomName: string;
};

export function createLiveKitAgentDispatcher(
  config: Pick<LiveKitConfig, "url" | "apiKey" | "apiSecret">,
): LiveKitAgentDispatcher {
  return new AgentDispatchClient(config.url, config.apiKey, config.apiSecret);
}

export function createLiveKitRoomName(input: { workflowRunId: string; launchId: string }) {
  return `workflow-${input.workflowRunId}-${input.launchId}`;
}

export function createParticipantIdentity(input: { workflowRunId: string; launchId: string }) {
  return `browser-${input.workflowRunId}-${input.launchId}`;
}

export function serializeLiveKitDispatchMetadata(metadata: LiveKitDispatchMetadata) {
  return JSON.stringify(metadata);
}

export function parseLiveKitDispatchMetadata(value: string): LiveKitDispatchMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("LiveKit dispatch metadata is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LiveKit dispatch metadata is invalid.");
  }
  const metadata = parsed as Record<string, unknown>;
  if (
    metadata.version !== 1 ||
    typeof metadata.voiceSessionId !== "string" ||
    !metadata.voiceSessionId ||
    typeof metadata.launchId !== "string" ||
    !metadata.launchId ||
    typeof metadata.roomName !== "string" ||
    !metadata.roomName
  ) {
    throw new Error("LiveKit dispatch metadata is invalid.");
  }
  return metadata as LiveKitDispatchMetadata;
}

export async function createBrowserVoiceSessionLaunch(input: {
  config: LiveKitConfig;
  store: LiveKitTokenStore;
  dispatcher?: LiveKitAgentDispatcher;
  workflowRunId: string;
  caseId: string;
  createLaunchId?: () => string;
}): Promise<BrowserVoiceSessionLaunch> {
  const launchId = (input.createLaunchId ?? randomUUID)();
  const roomName = createLiveKitRoomName({
    workflowRunId: input.workflowRunId,
    launchId,
  });
  const participantIdentity = createParticipantIdentity({
    workflowRunId: input.workflowRunId,
    launchId,
  });
  const dispatcher = input.dispatcher ?? createLiveKitAgentDispatcher(input.config);

  const voiceSessionId = await input.store.createLiveKitSession({
    caseId: input.caseId,
    workflowRunId: input.workflowRunId,
    launchId,
    roomName,
    participantIdentity,
  });
  let dispatch: { id: string } | undefined;

  try {
    dispatch = await dispatcher.createDispatch(roomName, input.config.agentName, {
      metadata: serializeLiveKitDispatchMetadata({
        version: 1,
        voiceSessionId,
        launchId,
        roomName,
      }),
    });
    await input.store.updateLiveKitSessionProviderSessionId(voiceSessionId, dispatch.id);

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

    return {
      launchId,
      roomName,
      participantIdentity,
      token: await token.toJwt(),
      workflowRunId: input.workflowRunId,
      caseId: input.caseId,
      livekitUrl: input.config.url,
    };
  } catch (error) {
    const endedReason = dispatch ? "launch_failed" : "dispatch_failed";
    const cleanup = [
      input.store.finalizeLiveKitSession(voiceSessionId, "failed", endedReason),
      input.store.appendSessionEvent({
        voiceSessionId,
        type: "session.failed",
        payload: { reason: endedReason },
        occurredAt: new Date(),
      }),
    ];
    if (dispatch) cleanup.push(dispatcher.deleteDispatch(dispatch.id, roomName));
    const cleanupResults = await Promise.allSettled(cleanup);
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "LiveKit voice session launch failed and cleanup was incomplete.",
      );
    }
    throw error;
  }
}
