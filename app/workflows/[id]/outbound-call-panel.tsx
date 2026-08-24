import { placeOutboundCallAction } from "../../actions/phone";
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
        <p className="text-sm text-muted">This case has no client to call.</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">Outbound call</h2>
      <p className="text-sm">
        Client: {props.context.clientName} at {props.context.clientPhone || "no phone on file"}
      </p>
      <p className="text-sm text-muted">
        Timezone: {props.context.timeZone} ({props.context.timeZoneSource})
      </p>
      <p className="mt-2 text-sm text-muted">
        Manual test only. This does not wait for a scheduled follow-up. Compliance flags are recorded, not enforced.
      </p>
      <form action={placeOutboundCallAction} className="mt-4">
        <input type="hidden" name="workflowRunId" value={props.workflowRunId} />
        <button
          type="submit"
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!props.context.clientPhone}
        >
          Call {props.context.clientName}
        </button>
      </form>
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
