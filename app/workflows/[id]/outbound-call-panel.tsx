import { Info, Phone, PhoneOutgoing } from "lucide-react";
import { placeOutboundCallAction } from "../../actions/phone";
import { resolveOutboundCallee } from "@/modules/phone/callee";
import { toE164 } from "@/modules/phone/phone-number";
import { formatInTimeZone } from "@/modules/time/timezone";
import type { OutboundCallContext, PhoneCallRecord } from "@/modules/phone/types";
import { Callout, Card, CardHeader, EmptyState, StatusBadge, Timeline, btn, formatDateTime, humanize } from "../../components/ui";

export function OutboundCallPanel(props: {
  workflowRunId: string;
  context: OutboundCallContext | null;
  calls: PhoneCallRecord[];
}) {
  if (!props.context) {
    return (
      <Card>
        <CardHeader title="Outbound call" icon={<PhoneOutgoing size={15} />} />
        <EmptyState icon={<PhoneOutgoing size={28} />}>
          This workflow has no client on the case, so it cannot place a call.
        </EmptyState>
      </Card>
    );
  }

  const callee = resolveOutboundCallee(props.context);
  const dialable = Boolean(toE164(callee.phone));

  return (
    <Card>
      <CardHeader
        title="Outbound call"
        icon={<PhoneOutgoing size={15} />}
        description="Places a live Twilio call. The worker also auto-dials due follow-ups when AUTO_OUTBOUND_CALLS is enabled."
      />
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">
              {callee.role === "provider" ? "Provider" : "Client"}: {callee.name}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {callee.phone || "No phone on file"} · Timezone: {props.context.timeZone} ({props.context.timeZoneSource})
            </p>
          </div>
          <form action={placeOutboundCallAction}>
            <input type="hidden" name="workflowRunId" value={props.workflowRunId} />
            <button className={btn.primary} disabled={!dialable} type="submit">
              <Phone aria-hidden size={14} />
              {dialable ? `Call ${callee.name}` : "Number missing"}
            </button>
          </form>
        </div>

        {!dialable ? (
          <p className="mt-3 text-sm text-muted">
            Put a real E.164 number on the {callee.role === "provider" ? "provider organization" : "client"} in the case
            file, then try again.
          </p>
        ) : null}

        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Recent calls</h3>
          {props.calls.length === 0 ? (
            <EmptyState>No outbound calls have been placed yet.</EmptyState>
          ) : (
            <Timeline
              items={[...props.calls].reverse().map((call) => ({
                id: call.id,
                title: humanize(call.connectionStatus),
                badge: <StatusBadge status={call.connectionStatus} />,
                body: (
                  <>
                    <span className="font-mono text-xs">{call.twilioCallSid ?? "no call sid"}</span>
                    {call.complianceFlags.length > 0 ? (
                      <ul className="mt-1 list-disc pl-4 text-xs text-warning">
                        {call.complianceFlags.map((flag) => (
                          <li key={flag.code}>
                            {flag.code}: {flag.detail}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {call.transcript.length > 0 ? (
                      <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-panel/60 p-3">
                        {call.transcript.map((turn, index) => (
                          <p className="text-sm leading-snug" key={`${call.id}-${index}`}>
                            <span
                              className={`mr-1.5 inline-block rounded px-1.5 py-0.5 align-baseline text-[10px] font-semibold uppercase tracking-wide ${
                                turn.speaker === "agent"
                                  ? "bg-teal-100 text-teal-800"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {turn.speaker}
                            </span>
                            {turn.text}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {call.structuredOutcome ? (
                      <div className="mt-2">
                        <Callout tone="info">
                          Outcome: {call.structuredOutcome.status}. Sentiment: {call.structuredOutcome.sentiment}.
                          {call.structuredOutcome.requestedCallbackLocal
                            ? ` Callback: ${call.structuredOutcome.requestedCallbackLocal}.`
                            : ""}
                        </Callout>
                      </div>
                    ) : null}
                  </>
                ),
                meta: `${formatInTimeZone(call.createdAt, call.timeZone)} (${formatDateTime(call.createdAt)})`,
                dotTone:
                  call.connectionStatus === "answered"
                    ? "success"
                    : call.connectionStatus === "failed"
                      ? "danger"
                      : "neutral",
              }))}
            />
          )}
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-xs text-muted">
          <Info aria-hidden className="mt-0.5 shrink-0" size={13} />
          Twilio webhooks require a public PUBLIC_BASE_URL. Demo 555 numbers are not reachable.
        </p>
      </div>
    </Card>
  );
}
