import { LiveKitVoiceLauncher } from "./livekit-room";
import { getVoiceConsoleData, voiceSessionLabel } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const { events, runs, sessions } = await getVoiceConsoleData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Voice sessions</h1>
        <p className="mt-1 text-sm text-muted">
          Real LiveKit sessions require <code>npm run voice:agent</code> and LiveKit environment variables. Outbound phone follow-ups place real Twilio calls.
        </p>
      </div>

      <LiveKitVoiceLauncher runs={runs.map((run) => ({ id: run.id, title: run.title, summary: run.summary }))} />

      <section className="border-t border-line pt-5">
        <h2 className="font-semibold">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="py-3 text-sm text-muted">No voice sessions have been recorded.</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="font-medium">{voiceSessionLabel(session)}</span>
                <span className="text-muted">{session.startedAt.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line pt-5">
        <h2 className="font-semibold">Recent session events</h2>
        {events.length === 0 ? (
          <p className="py-3 text-sm text-muted">No transcript or tool events have been recorded.</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {events.map(({ event, session }) => (
              <div key={event.id} className="grid gap-1 py-2 text-sm md:grid-cols-[12rem_10rem_1fr]">
                <span className="font-medium">{event.type}</span>
                <span className="text-muted">{voiceSessionLabel(session)}</span>
                <span className="break-words text-muted">{voiceEventSummary(event)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function voiceEventSummary(event: { text: string | null; speaker: string | null; toolCallId: string | null; payload: unknown }) {
  if (event.text) return `${event.speaker ?? "speaker"}: ${event.text}`;
  if (event.toolCallId) return `${event.toolCallId}: ${payloadSummary(event.payload)}`;
  return payloadSummary(event.payload);
}

function payloadSummary(payload: unknown) {
  if (typeof payload !== "object" || payload === null || Object.keys(payload).length === 0) return "Lifecycle event";
  const message = "message" in payload && typeof payload.message === "string" ? payload.message : undefined;
  if (message) return message;
  const action = "action" in payload && typeof payload.action === "object" && payload.action !== null ? payload.action : undefined;
  if (action && "summary" in action && typeof action.summary === "string") return action.summary;
  return JSON.stringify(payload);
}
