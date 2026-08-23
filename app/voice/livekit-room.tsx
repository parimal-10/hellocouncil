"use client";

import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { Mic, PhoneOff } from "lucide-react";
import React, { useState, useTransition } from "react";
import { createLiveKitVoiceSessionAction } from "../actions/livekit";
import type { BrowserVoiceSessionLaunch } from "@/modules/voice/livekit-types";

export function LiveKitVoiceLauncher({ runs }: { runs: Array<{ id: string; title: string; summary: string }> }) {
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
    <section className="rounded border border-line bg-white p-4">
      <h2 className="font-semibold">Real LiveKit session</h2>
      <p className="text-sm text-muted">Start a browser microphone session for a workflow run.</p>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {runs.map((run) => (
          <form key={run.id} action={startSession} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
            <input type="hidden" name="workflowRunId" value={run.id} />
            <p className="font-medium">{run.title}</p>
            <p className="text-sm text-muted">{run.summary}</p>
            <button
              className="mt-2 rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              type="submit"
              disabled={isPending}
            >
              <Mic className="inline-block" size={16} /> Start LiveKit session
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}

type LiveKitRoomState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "connection_error"
  | "microphone_error";

export function LiveKitActiveRoom({
  launch,
  onEnd,
}: {
  launch: BrowserVoiceSessionLaunch;
  onEnd: () => void;
}) {
  const [roomState, setRoomState] = useState<LiveKitRoomState>("connecting");

  return (
    <section className="rounded border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Live voice session</h2>
          <p className="text-sm text-muted">{launch.roomName}</p>
        </div>
        <button
          className="rounded border border-line px-3 py-2 text-sm"
          type="button"
          onClick={onEnd}
        >
          <PhoneOff className="inline-block" size={16} /> End view
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
        <p className="text-sm text-muted" role="status">
          {roomStatusMessage(roomState)}
        </p>
      </LiveKitRoom>
    </section>
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
