export type LiveKitLifecycleStore = {
  markLiveKitSessionRunning(voiceSessionId: string): Promise<boolean>;
  finalizeLiveKitSession(
    voiceSessionId: string,
    status: "completed" | "failed",
    endedReason: string,
  ): Promise<boolean>;
  appendSessionEvent(input: {
    voiceSessionId: string;
    type: string;
    speaker?: string;
    text?: string;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void>;
};

type UserInputTranscribedEvent = {
  transcript: string;
  isFinal: boolean;
  itemId: string | null;
  speakerId: string | null;
  language: string | null;
  createdAt: number;
};

type ConversationItemAddedEvent = {
  item: {
    id: string;
    type: string;
    role?: string;
    textContent?: string;
    interrupted?: boolean;
  };
  createdAt: number;
};

type SessionErrorEvent = {
  error: unknown;
  createdAt: number;
};

type SessionCloseEvent = {
  reason: string;
  error: unknown | null;
  createdAt: number;
};

export class LiveKitVoiceSessionLifecycle {
  private finalization: Promise<void> | undefined;
  private encounteredError = false;

  constructor(
    private readonly voiceSessionId: string,
    private readonly store: LiveKitLifecycleStore,
  ) {}

  async start(occurredAt = new Date()) {
    const transitioned = await this.store.markLiveKitSessionRunning(this.voiceSessionId);
    if (!transitioned) {
      throw new Error(`LiveKit voice session ${this.voiceSessionId} is not pending.`);
    }
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: "session.started",
      occurredAt,
    });
  }

  async participantConnected(participantIdentity: string, occurredAt = new Date()) {
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: "participant.connected",
      speaker: "user",
      payload: { participantIdentity },
      occurredAt,
    });
  }

  async userInputTranscribed(event: UserInputTranscribedEvent) {
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: "transcript_chunk",
      speaker: "user",
      text: event.transcript,
      payload: {
        isFinal: event.isFinal,
        itemId: event.itemId,
        language: event.language,
      },
      occurredAt: new Date(event.createdAt),
    });
  }

  async conversationItemAdded(event: ConversationItemAddedEvent) {
    if (event.item.type !== "message" || !event.item.role || !event.item.textContent) return;
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: "conversation.item_added",
      speaker: event.item.role,
      text: event.item.textContent,
      payload: {
        itemId: event.item.id,
        interrupted: Boolean(event.item.interrupted),
      },
      occurredAt: new Date(event.createdAt),
    });
  }

  async sessionError(event: SessionErrorEvent) {
    this.encounteredError = true;
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: "session.error",
      payload: { message: "The LiveKit voice session encountered an internal error." },
      occurredAt: new Date(event.createdAt),
    });
  }

  close(event: SessionCloseEvent) {
    const failed = event.error !== null || event.reason === "error";
    return this.finalize(
      failed ? "failed" : "completed",
      event.reason,
      new Date(event.createdAt),
    );
  }

  fail(reason: string, occurredAt = new Date()) {
    return this.finalize("failed", reason, occurredAt);
  }

  complete(reason: string, occurredAt = new Date()) {
    if (this.encounteredError) return this.finalize("failed", "error", occurredAt);
    return this.finalize("completed", reason, occurredAt);
  }

  private finalize(
    status: "completed" | "failed",
    endedReason: string,
    occurredAt: Date,
  ) {
    this.finalization ??= this.persistFinalization(status, endedReason, occurredAt);
    return this.finalization;
  }

  private async persistFinalization(
    status: "completed" | "failed",
    endedReason: string,
    occurredAt: Date,
  ) {
    const transitioned = await this.store.finalizeLiveKitSession(
      this.voiceSessionId,
      status,
      endedReason,
    );
    if (!transitioned) return;
    await this.store.appendSessionEvent({
      voiceSessionId: this.voiceSessionId,
      type: status === "completed" ? "session.completed" : "session.failed",
      payload: { reason: endedReason },
      occurredAt,
    });
  }
}
