import { Mic, Radio, Webhook } from "lucide-react";
import { LiveKitVoiceLauncher } from "./livekit-room";
import { getVoiceConsoleData, voiceSessionLabel } from "@/modules/dashboard/queries";
import { Card, CardHeader, EmptyState, PageHeader, StatusBadge, Timeline, formatDateTime, humanize } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
  const { events, runs, sessions } = await getVoiceConsoleData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voice"
        title="Voice sessions"
        description="Browser sessions run over LiveKit; scheduled follow-ups place real Twilio calls."
      />

      <LiveKitVoiceLauncher runs={runs.map((run) => ({ id: run.id, title: run.title, summary: run.summary }))} />

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Recent sessions" icon={<Radio size={15} />} />
          {sessions.length === 0 ? (
            <EmptyState icon={<Radio size={28} />}>No voice sessions have been recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {sessions.map((session) => (
                <li className="flex items-center justify-between gap-3 px-5 py-3" key={session.id}>
                  <span className="truncate font-mono text-xs text-ink">{voiceSessionLabel(session)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={session.status} />
                    <span className="text-xs text-muted">{formatDateTime(session.startedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent session events" icon={<Webhook size={15} />} />
          {events.length === 0 ? (
            <EmptyState icon={<Webhook size={28} />}>No transcript or tool events have been recorded.</EmptyState>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto px-5 py-4">
              <Timeline
                items={[...events].reverse().map(({ event, session }) => ({
                  id: event.id,
                  title: humanize(event.type),
                  badge: event.toolCallId ? (
                    <span className="font-mono text-[10px] text-muted">{event.toolCallId}</span>
                  ) : undefined,
                  body: voiceEventSummary(event),
                  meta: `${voiceSessionLabel(session)} · ${formatDateTime(event.occurredAt)}`,
                  dotTone:
                    event.type === "tool_result"
                      ? "info"
                      : event.type.includes("fail") || event.type === "error"
                        ? "danger"
                        : "accent",
                }))}
              />
            </div>
          )}
        </Card>
      </section>

      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Mic aria-hidden className="mt-0.5 shrink-0" size={13} />
        Real LiveKit sessions require <code>npm run voice:agent</code> and LiveKit environment variables.
      </p>
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
