import {
  ServerOptions,
  cli,
  defineAgent,
  inference,
  llm,
  voice,
  type JobProcess,
  type VAD,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { z } from "zod";
import { getLiveKitConfig, type LiveKitConfig } from "@/modules/livekit/config";
import {
  executeVoiceWorkflowTool,
  type VoiceToolEventStore,
  type VoiceToolName,
} from "./tools";

export type AgentModelConfig = Pick<
  LiveKitConfig,
  "sttModel" | "llmModel" | "ttsModel" | "ttsVoice"
>;

export function createAgentModelConfig(config: AgentModelConfig) {
  return config;
}

export function buildAgentInstructions() {
  return [
    "You are a legal operations voice agent for HelloCounsel.",
    "Use structured workflow tools for workflow updates, contact attempts, follow-ups, and review notes.",
    "Do not approve, reject, resolve, or assign legal review requests by voice.",
    "Do not give legal advice. If the user asks for legal advice, request human review.",
    "Keep spoken responses concise and confirm what was recorded.",
  ].join(" ");
}

export type VoiceSessionLookup = VoiceToolEventStore & {
  getLiveKitSessionByRoomName(roomName: string): Promise<{
    id: string;
    workflowRunId: string;
    caseId: string;
  } | null>;
};

export type VoiceWorkflowContext = {
  workflowRunId: string;
  voiceSessionId: string;
  voiceEventStore: VoiceToolEventStore;
};

export function requireLiveKitRoomName(roomName: string | undefined) {
  if (!roomName) throw new Error("Connected LiveKit room is missing its name.");
  return roomName;
}

export async function resolveVoiceWorkflowContext(
  roomName: string,
  store: VoiceSessionLookup,
): Promise<VoiceWorkflowContext> {
  const voiceSession = await store.getLiveKitSessionByRoomName(roomName);
  if (!voiceSession) {
    throw new Error(`No persisted LiveKit voice session found for room ${roomName}.`);
  }

  return {
    workflowRunId: voiceSession.workflowRunId,
    voiceSessionId: voiceSession.id,
    voiceEventStore: store,
  };
}

type VoiceToolExecutor = typeof executeVoiceWorkflowTool;

export function createWorkflowTools(
  context: VoiceWorkflowContext,
  executeTool: VoiceToolExecutor = executeVoiceWorkflowTool,
) {
  const execute = (toolName: VoiceToolName, payload: unknown, toolCallId: string) =>
    executeTool({
      workflowRunId: context.workflowRunId,
      toolName,
      payload,
      voiceEventStore: context.voiceEventStore,
      voiceSessionId: context.voiceSessionId,
      toolCallId,
    });

  return {
    create_update: llm.tool({
      name: "create_update",
      description: "Record a factual workflow update from the voice conversation.",
      parameters: z.object({ summary: z.string() }),
      execute: async (payload, { toolCallId }) => execute("create_update", payload, toolCallId),
    }),
    request_review: llm.tool({
      name: "request_review",
      description: "Request human review when automation should stop for legal or policy reasons.",
      parameters: z.object({
        reason: z.enum([
          "missing_authorization",
          "ambiguous_client_response",
          "provider_refusal",
          "sensitive_legal_advice",
          "failed_contact_threshold",
        ]),
        summary: z.string(),
      }),
      execute: async (payload, { toolCallId }) => execute("request_review", payload, toolCallId),
    }),
    mark_contact_attempt: llm.tool({
      name: "mark_contact_attempt",
      description: "Record that the current voice session included a contact attempt.",
      parameters: z.object({
        outcome: z.enum(["reached", "left_message", "failed", "refused"]),
        summary: z.string(),
      }),
      execute: async (payload, { toolCallId }) =>
        execute("mark_contact_attempt", payload, toolCallId),
    }),
    schedule_follow_up: llm.tool({
      name: "schedule_follow_up",
      description: "Schedule a follow-up workflow step.",
      parameters: z.object({
        stepType: z.string(),
        dueAt: z.string(),
        reason: z.string(),
      }),
      execute: async (payload, { toolCallId }) => execute("schedule_follow_up", payload, toolCallId),
    }),
    add_review_note: llm.tool({
      name: "add_review_note",
      description: "Add a note to an existing human review request without resolving it.",
      parameters: z.object({
        reviewRequestId: z.string(),
        note: z.string(),
      }),
      execute: async (payload, { toolCallId }) => execute("add_review_note", payload, toolCallId),
    }),
  };
}

type AgentProcessData = {
  vad: VAD;
};

export function createLiveKitAgent() {
  return defineAgent<AgentProcessData>({
    prewarm: async (proc: JobProcess<AgentProcessData>) => {
      proc.userData.vad = await silero.VAD.load();
    },
    entry: async (ctx) => {
      const config = getLiveKitConfig();
      const modelConfig = createAgentModelConfig(config);

      await ctx.connect();

      const livekit = await import("@livekit/agents-plugin-livekit");
      const { DrizzleVoiceSessionStore } = await import("@/modules/voice/store");
      const voiceEventStore = new DrizzleVoiceSessionStore();
      const roomName = requireLiveKitRoomName(ctx.room.name);
      const workflowContext = await resolveVoiceWorkflowContext(roomName, voiceEventStore);
      const workflowTools = createWorkflowTools(workflowContext);
      const inferenceCredentials = {
        apiKey: config.inferenceApiKey,
        apiSecret: config.apiSecret,
      };
      const agent = new voice.Agent({
        instructions: buildAgentInstructions(),
        tools: Object.values(workflowTools),
      });
      const session = new voice.AgentSession({
        stt: new inference.STT({
          model: modelConfig.sttModel,
          language: "en",
          ...inferenceCredentials,
        }),
        llm: new inference.LLM({
          model: modelConfig.llmModel,
          ...inferenceCredentials,
        }),
        tts: new inference.TTS({
          model: modelConfig.ttsModel,
          voice: modelConfig.ttsVoice,
          ...inferenceCredentials,
        }),
        vad: ctx.proc.userData.vad,
        turnHandling: {
          turnDetection: new livekit.turnDetector.MultilingualModel(),
        },
      });

      await session.start({ agent, room: ctx.room });
      await session.generateReply({
        instructions: "Greet the user and ask what workflow update they want to record.",
      });
    },
  });
}

export function runVoiceAgentCli(agentFile: string) {
  cli.runApp(new ServerOptions({ agent: agentFile }));
}
