import { runSimulatedVoiceSessionAction } from "../actions/voice";
import { LiveKitVoiceLauncher } from "./livekit-room";
import { getVoiceConsoleData } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const { events, runs, sessions } = await getVoiceConsoleData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Voice sessions</h1>
      </div>

      <LiveKitVoiceLauncher runs={runs.map((run) => ({ id: run.id, title: run.title, summary: run.summary }))} />

      <section className="border-t border-line pt-5">
        <h2 className="font-semibold">Simulated voice session</h2>
        <p className="text-sm text-muted">Replays transcript chunks and structured tool calls through the platform action router.</p>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">There are no workflow runs available for a simulated session.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {runs.map((run) => (
              <form key={run.id} action={runSimulatedVoiceSessionAction} className="rounded border border-line bg-white p-4">
                <input type="hidden" name="workflowRunId" value={run.id} />
                <p className="font-medium">{run.title}</p>
                <p className="text-sm text-muted">{run.summary}</p>
                <button className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
                  Run simulated session
                </button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line pt-5">
        <h2 className="font-semibold">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="py-3 text-sm text-muted">No simulated sessions have been recorded.</p>
        ) : (
          <div className="mt-2 divide-y divide-line">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="font-medium">{session.provider}</span>
                <span className="text-muted">{session.status} - {session.startedAt.toLocaleString()}</span>
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
                <span className="text-muted">{session.provider} - {session.status}</span>
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
