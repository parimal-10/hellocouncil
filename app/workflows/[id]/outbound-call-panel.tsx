import { placeOutboundCallAction } from "../../actions/phone";
import { resolveOutboundCallee } from "@/modules/phone/callee";
import { toE164 } from "@/modules/phone/phone-number";
import { formatInTimeZone } from "@/modules/time/timezone";
import type { OutboundCallContext, PhoneCallRecord } from "@/modules/phone/types";

export function OutboundCallPanel(props: {
  workflowRunId: string;
  context: OutboundCallContext | null;
  calls: PhoneCallRecord[];
}) {
  if (!props.context) {
    return (
      <section className="rounded border border-line bg-white p-4">
        <h2 className="mb-3 font-semibold">Outbound call</h2>
        <p className="text-sm text-muted">This workflow has no client on the case, so it cannot place a call.</p>
      </section>
    );
  }

  const callee = resolveOutboundCallee(props.context);
  const dialable = Boolean(toE164(callee.phone));

  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">Outbound call</h2>
      <p className="text-sm">
        {callee.role === "provider" ? "Provider" : "Client"}: {callee.name} at {callee.phone || "no phone on file"}
      </p>
      <p className="text-sm text-muted">
        Timezone: {props.context.timeZone} ({props.context.timeZoneSource})
      </p>
      <p className="mt-2 text-sm text-muted">
        Places a live Twilio call. The worker also auto-dials due follow-ups when AUTO_OUTBOUND_CALLS is enabled.
        Twilio webhooks require a public PUBLIC_BASE_URL. Demo 555 numbers are not reachable.
      </p>
      <form action={placeOutboundCallAction} className="mt-4">
        <input type="hidden" name="workflowRunId" value={props.workflowRunId} />
        <button
          type="submit"
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!dialable}
        >
          Call {callee.name}
        </button>
      </form>
      {!dialable ? (
        <p className="mt-2 text-sm text-muted">
          Put a real E.164 number on the {callee.role === "provider" ? "provider organization" : "client"} in the case
          file, then try again.
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        {props.calls.length === 0 ? (
          <p className="text-sm text-muted">No outbound calls have been placed yet.</p>
        ) : (
          props.calls.map((call) => (
            <div key={call.id} className="border-b border-line py-3 last:border-b-0">
              <p className="font-medium">
                {call.connectionStatus}
                {call.twilioCallSid ? ` · ${call.twilioCallSid}` : ""}
              </p>
              <p className="text-xs text-muted">{formatInTimeZone(call.createdAt, call.timeZone)}</p>
              {call.complianceFlags.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                  {call.complianceFlags.map((flag) => (
                    <li key={flag.code}>{flag.code}: {flag.detail}</li>
                  ))}
                </ul>
              ) : null}
              {call.transcript.length > 0 ? (
                <div className="mt-2 space-y-1 text-sm">
                  {call.transcript.map((turn, index) => (
                    <p key={`${call.id}-${index}`}>
                      <span className="font-medium">{turn.speaker}:</span> {turn.text}
                    </p>
                  ))}
                </div>
              ) : null}
              {call.structuredOutcome ? (
                <p className="mt-2 text-sm text-muted">
                  Outcome: {call.structuredOutcome.status}. Sentiment: {call.structuredOutcome.sentiment}.
                  {call.structuredOutcome.requestedCallbackLocal
                    ? ` Callback: ${call.structuredOutcome.requestedCallbackLocal}.`
                    : ""}
                </p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
