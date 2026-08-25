"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { Mic, MicOff, PhoneCall, PhoneOff } from "lucide-react";
import React, { useState, useTransition } from "react";
import { createLiveKitVoiceSessionAction } from "../actions/livekit";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";
import { Card, CardHeader, cx } from "../components/ui";

export function LiveKitVoiceLauncher({
  runs,
  heading = "Real LiveKit session",
  description = "Start a browser microphone session for a workflow run.",
  buttonLabel = "Start LiveKit session",
}: {
  runs: Array<{ id: string; title: string; summary: string }>;
  heading?: string;
  description?: string;
  buttonLabel?: string;
}) {
  const [launch, setLaunch] = useState<BrowserVoiceSessionLaunch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startSession(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        setLaunch(await createLiveKitVoiceSessionAction(formData));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to start LiveKit session.");
      }
    });
  }

  if (launch) {
    return <LiveKitActiveRoom launch={launch} onEnd={() => setLaunch(null)} />;
  }

  return (
    <Card>
      <CardHeader title={heading} icon={<Mic size={15} />} description={description} />
      <div className="px-5 py-4">
        {error ? (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="space-y-3">
          {runs.map((run) => (
            <form
              key={run.id}
              action={startSession}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel/50 p-3"
            >
              <input type="hidden" name="workflowRunId" value={run.id} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{run.title}</p>
                <p className="truncate text-xs text-muted">{run.summary}</p>
              </div>
              <button
                className={cx(
                  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50",
                )}
                disabled={isPending}
                type="submit"
              >
                {isPending ? <MicOff aria-hidden size={15} /> : <Mic aria-hidden size={15} />}
                {isPending ? "Starting..." : buttonLabel}
              </button>
            </form>
          ))}
        </div>
      </div>
    </Card>
  );
}

type LiveKitRoomState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "connection_error"
  | "microphone_error";

const stateTones: Record<LiveKitRoomState, string> = {
  connecting: "bg-blue-50 text-blue-700 ring-blue-600/20",
  connected: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  disconnected: "bg-slate-100 text-slate-600 ring-slate-500/20",
  connection_error: "bg-red-50 text-red-700 ring-red-600/20",
  microphone_error: "bg-red-50 text-red-700 ring-red-600/20",
};

export function LiveKitActiveRoom({
  launch,
  onEnd,
}: {
  launch: BrowserVoiceSessionLaunch;
  onEnd: () => void;
}) {
  const [roomState, setRoomState] = useState<LiveKitRoomState>("connecting");

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <PhoneCall aria-hidden className="text-muted" size={15} />
            Live voice session
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                stateTones[roomState],
              )}
              role="status"
            >
              <span
                aria-hidden
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  roomState === "connected" && "animate-pulse bg-emerald-500",
                  roomState === "connecting" && "animate-pulse bg-blue-500",
                  (roomState === "disconnected" || roomState === "connection_error" || roomState === "microphone_error") && "bg-current",
                )}
              />
              {roomStatusMessage(roomState)}
            </span>
          </h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{launch.roomName}</p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel"
          onClick={onEnd}
          type="button"
        >
          <PhoneOff aria-hidden size={15} /> End view
        </button>
      </div>
      <LiveKitRoom
        token={launch.token}
        serverUrl={launch.livekitUrl}
        connect
        audio
        onConnected={() => setRoomState("connected")}
        onDisconnected={() => setRoomState("disconnected")}
        onError={() => setRoomState("connection_error")}
        onMediaDeviceFailure={() => setRoomState("microphone_error")}
      >
        <RoomAudioRenderer />
      </LiveKitRoom>
    </Card>
  );
}

function roomStatusMessage(state: LiveKitRoomState) {
  if (state === "connected") return "Connected with microphone enabled.";
  if (state === "disconnected") return "Disconnected from LiveKit.";
  if (state === "connection_error") return "Unable to connect to the LiveKit room.";
  if (state === "microphone_error") {
    return "Microphone unavailable. Check browser permissions and input device.";
  }
  return "Connecting to LiveKit...";
}
