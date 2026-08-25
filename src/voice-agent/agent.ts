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
import { parseLiveKitDispatchMetadata } from "@/modules/livekit/token";
import { loadWorkflowBriefing, type WorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowStore } from "@/modules/workflows/store";
import {
  executeVoiceWorkflowTool,
  type VoiceToolEventStore,
  type VoiceToolName,
} from "./tools";
import { LiveKitVoiceSessionLifecycle } from "./lifecycle";

export type AgentModelConfig = Pick<
  LiveKitConfig,
  "sttModel" | "llmModel" | "ttsModel" | "ttsVoice"
>;

export function createAgentModelConfig(config: AgentModelConfig) {
  return config;
}

export function createTurnDetection(credentials: { apiKey: string; apiSecret: string }) {
  return new inference.TurnDetector({
    apiKey: credentials.apiKey,
    apiSecret: credentials.apiSecret,
  });
}

export function buildAgentInstructions(briefing?: WorkflowBriefing) {
  return [
    "You are a legal operations voice agent for HelloCounsel.",
    "You can look up case status, record updates, mark contact attempts, schedule follow-ups, run a due follow-up now, request human review, and add review notes.",
    "When asked what is happening, the current status, history, or next steps, call get_workflow_status before answering.",
    "When asked to follow up now, call now, or do the outreach immediately, call run_follow_up_now.",
    "When asked to schedule a later follow-up, call schedule_follow_up. For short delays like 'in one minute' or a specific time, pass an exact dueAt ISO-8601 timestamp; otherwise prefer dueInHours.",
    "Never say you cannot perform a supported workflow action without first calling the matching tool.",
    "Do not approve, reject, resolve, or assign legal review requests by voice.",
    "Do not give legal advice. If the user asks for legal advice, request human review.",
    "Keep spoken responses concise and confirm what the tools recorded.",
    briefing?.agentContext,
  ]
    .filter(Boolean)
    .join(" ");
}

export type VoiceSessionLookup = VoiceToolEventStore & {
  getLiveKitSessionById(voiceSessionId: string): Promise<{
    id: string;
    launchId: string;
    workflowRunId: string;
    caseId: string;
    roomName: string;
    participantIdentity: string;
    status: string;
  } | null>;
};

export type VoiceWorkflowContext = {
  workflowRunId: string;
  voiceSessionId: string;
  participantIdentity: string;
  voiceEventStore: VoiceToolEventStore;
  briefing?: WorkflowBriefing;
};

export function requireLiveKitRoomName(roomName: string | undefined) {
  if (!roomName) throw new Error("Connected LiveKit room is missing its name.");
  return roomName;
}

export async function resolveVoiceWorkflowContext(
  input: {
    dispatchMetadata: string;
    roomName: string;
    voiceStore: VoiceSessionLookup;
    workflowStore: Pick<WorkflowStore, "getRun">;
    getDefinition?: typeof getWorkflowDefinition;
  },
): Promise<VoiceWorkflowContext> {
  const metadata = parseLiveKitDispatchMetadata(input.dispatchMetadata);
  if (metadata.roomName !== input.roomName) {
    throw new Error("LiveKit dispatch metadata does not match the assigned room.");
  }

  const voiceSession = await input.voiceStore.getLiveKitSessionById(metadata.voiceSessionId);
  if (!voiceSession) {
    throw new Error(
      `No persisted LiveKit voice session found for id ${metadata.voiceSessionId}.`,
    );
  }
  if (
    voiceSession.launchId !== metadata.launchId ||
    voiceSession.roomName !== metadata.roomName ||
    voiceSession.status !== "pending"
  ) {
    throw new Error("LiveKit dispatch metadata does not match a pending persisted launch.");
  }

  const run = await input.workflowStore.getRun(voiceSession.workflowRunId);
  if (run.caseId !== voiceSession.caseId) {
    throw new Error("LiveKit voice session does not match its persisted workflow run.");
  }
  (input.getDefinition ?? getWorkflowDefinition)(run.definitionId);

  return {
    workflowRunId: voiceSession.workflowRunId,
    voiceSessionId: voiceSession.id,
    participantIdentity: voiceSession.participantIdentity,
    voiceEventStore: input.voiceStore,
  };
}

type VoiceToolExecutor = typeof executeVoiceWorkflowTool;

export function createWorkflowTools(
  context: VoiceWorkflowContext,
  executeTool: VoiceToolExecutor = executeVoiceWorkflowTool,
) {
  const execute = async (toolName: VoiceToolName, payload: unknown, toolCallId: string) => {
    try {
      return await executeTool({
        workflowRunId: context.workflowRunId,
        toolName,
        payload,
        voiceEventStore: context.voiceEventStore,
        voiceSessionId: context.voiceSessionId,
        toolCallId,
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "The voice workflow tool could not be completed.",
      };
    }
  };
  const stepTypes = context.briefing?.validStepTypes ?? [];
  const stepTypeHint = stepTypes.length > 0
    ? `stepType must be one of: ${stepTypes.join(", ")}. If omitted, the workflow default is used.`
    : "If stepType is omitted, the workflow default follow-up type is used.";
  const reviewHint = context.briefing?.openReviews[0]
    ? ` Open review id: ${context.briefing.openReviews[0].id}.`
    : "";

  return {
    get_workflow_status: llm.tool({
      name: "get_workflow_status",
      description: "Look up the current case status, what has happened so far, and the next scheduled follow-up.",
      execute: async (_payload, { toolCallId }) => execute("get_workflow_status", {}, toolCallId),
    }),
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
      description: `Schedule a future follow-up workflow step. ${stepTypeHint} dueAt should be ISO-8601 and is required for short delays such as "in one minute"; otherwise pass dueInHours.`,
      parameters: z.object({
        stepType: z.string().optional(),
        dueAt: z.string().optional(),
        dueInHours: z.number().optional(),
        reason: z.string(),
      }),
      execute: async (payload, { toolCallId }) => execute("schedule_follow_up", payload, toolCallId),
    }),
    run_follow_up_now: llm.tool({
      name: "run_follow_up_now",
      description: "Execute the next follow-up immediately using the platform agent. Use this when the user asks to follow up now.",
      execute: async (_payload, { toolCallId }) => execute("run_follow_up_now", {}, toolCallId),
    }),
    add_review_note: llm.tool({
      name: "add_review_note",
      description: `Add a note to an existing human review request without resolving it.${reviewHint}`,
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
      const [{ DrizzleVoiceSessionStore }, { DrizzleWorkflowStore }] =
        await Promise.all([
          import("@/modules/voice/store"),
          import("@/modules/workflows/store"),
        ]);
      const voiceStore = new DrizzleVoiceSessionStore();
      const roomName = requireLiveKitRoomName(ctx.job.room?.name ?? ctx.room.name);
      const workflowContext = await resolveVoiceWorkflowContext({
        dispatchMetadata: ctx.job.metadata,
        roomName,
        voiceStore,
        workflowStore: new DrizzleWorkflowStore(),
      });
      const lifecycle = new LiveKitVoiceSessionLifecycle(
        workflowContext.voiceSessionId,
        voiceStore,
      );
      const briefing = await loadWorkflowBriefing(workflowContext.workflowRunId);
      const workflowTools = createWorkflowTools({ ...workflowContext, briefing });
      const inferenceCredentials = {
        apiKey: config.inferenceApiKey,
        apiSecret: config.apiSecret,
      };
      ctx.addShutdownCallback(() => lifecycle.complete("job_shutdown"));

      try {
        await ctx.connect();
        await lifecycle.start();
        const participant = await ctx.waitForParticipant(
          workflowContext.participantIdentity,
        );
        await lifecycle.participantConnected(participant.identity);

        const agent = new voice.Agent({
          instructions: buildAgentInstructions(briefing),
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
            turnDetection: createTurnDetection(inferenceCredentials),
          },
        });
        const persist = (operation: Promise<void>) => {
          void operation.catch(async (error) => {
            console.error(
              `LiveKit voice session ${workflowContext.voiceSessionId} persistence failed.`,
              error,
            );
            try {
              await lifecycle.fail("persistence_error");
            } catch (finalizationError) {
              console.error(
                `LiveKit voice session ${workflowContext.voiceSessionId} failed finalization.`,
                finalizationError,
              );
            }
            ctx.shutdown("persistence_error");
          });
        };
        session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
          persist(lifecycle.userInputTranscribed(event));
        });
        session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
          persist(lifecycle.conversationItemAdded(event));
        });
        session.on(voice.AgentSessionEventTypes.Error, (event) => {
          persist(lifecycle.sessionError(event));
        });
        session.on(voice.AgentSessionEventTypes.Close, (event) => {
          persist(lifecycle.close(event));
        });

        await session.start({
          agent,
          room: ctx.room,
          inputOptions: {
            participantIdentity: workflowContext.participantIdentity,
            closeOnDisconnect: true,
          },
        });
        await session.generateReply({
          instructions: [
            "Greet the user.",
            `Briefly state the current case status: ${briefing.currentStatus}`,
            briefing.nextFollowUp
              ? `Mention the next follow-up: ${briefing.nextFollowUp.label} at ${briefing.nextFollowUp.dueAt.toISOString()}.`
              : "Mention that no follow-up is currently scheduled.",
            "Ask whether they want a status recap, to record an update, to schedule a follow-up, or to run the follow-up now.",
          ].join(" "),
        });
      } catch (error) {
        try {
          await lifecycle.fail("worker_error");
        } catch (persistenceError) {
          throw new AggregateError(
            [error, persistenceError],
            "LiveKit voice agent failed and session finalization was unsuccessful.",
          );
        }
        throw error;
      }
    },
  });
}

export function createVoiceAgentServerOptions(agentFile: string, config: LiveKitConfig) {
  return new ServerOptions({
    agent: agentFile,
    agentName: config.agentName,
    wsURL: config.url,
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
  });
}

export function runVoiceAgentCli(agentFile: string) {
  cli.runApp(createVoiceAgentServerOptions(agentFile, getLiveKitConfig()));
}
