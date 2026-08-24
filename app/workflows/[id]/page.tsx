import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LiveKitVoiceLauncher } from "../../voice/livekit-room";
import { OutboundCallPanel } from "./outbound-call-panel";
import { getWorkflowDetail } from "@/modules/dashboard/queries";
import { loadOutboundCallContext, DrizzlePhoneCallStore } from "@/modules/phone/store";
import { buildWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowDefinitionId } from "@/modules/workflows/types";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getWorkflowDetail(id);
  if (!detail) notFound();
  const definition = getWorkflowDefinition(detail.run.definitionId as WorkflowDefinitionId);
  const briefing = buildWorkflowBriefing({
    run: detail.run,
    definition,
    context: detail.context,
    steps: detail.steps,
    reviews: detail.reviews,
    attempts: detail.attempts,
    events: detail.events,
  });
  const phoneStore = new DrizzlePhoneCallStore();
  const [callContext, phoneCalls] = await Promise.all([
    loadOutboundCallContext(id).catch(() => null),
    phoneStore.listCallsForRun(id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">{definition.label}</p>
        <h1 className="text-2xl font-semibold">{detail.context?.matterName ?? detail.run.title}</h1>
        <p className="text-sm text-muted">
          {detail.context
            ? `Client: ${detail.context.clientName}${detail.context.providerName ? ` | Provider: ${detail.context.providerName}` : ""} | Owner: ${detail.context.assignedUserName}`
            : detail.caseRecord?.matterName ?? "Unknown case"}
        </p>
        <p className="mt-1 text-sm text-muted">{detail.run.title} - {detail.run.status}</p>
      </div>

      <section className="rounded border border-line bg-white p-4">
        <h2 className="mb-3 font-semibold">Current status</h2>
        <p>{briefing.currentStatus}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">What has happened</h3>
            {briefing.whatHappened.length === 0 ? (
              <EmptyState>No history has been recorded yet.</EmptyState>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {briefing.whatHappened.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Next steps</h3>
            {briefing.nextSteps.length === 0 ? (
              <EmptyState>No next steps are planned.</EmptyState>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {briefing.nextSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {briefing.nextFollowUp ? (
              <p className="mt-3 text-sm">
                Next follow-up: {briefing.nextFollowUp.label} at {briefing.nextFollowUp.dueAt.toLocaleString()}
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">No follow-up is currently scheduled.</p>
            )}
          </div>
        </div>
      </section>

      <OutboundCallPanel workflowRunId={detail.run.id} context={callContext} calls={phoneCalls} />

      <LiveKitVoiceLauncher
        runs={[{ id: detail.run.id, title: detail.run.title, summary: briefing.currentStatus }]}
        heading={briefing.canRunFollowUpNow ? "Do this follow-up now" : "Talk to the voice agent"}
        description={
          briefing.canRunFollowUpNow
            ? "Start a LiveKit session and tell the agent to run the follow-up now, or ask for the current case status."
            : "Start a LiveKit session to hear the current status. Outreach is paused until human review is resolved."
        }
        buttonLabel={briefing.canRunFollowUpNow ? "Do follow-up now with LiveKit" : "Ask the voice agent"}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Steps">
          {detail.steps.length === 0 ? (
            <EmptyState>No workflow steps have been scheduled.</EmptyState>
          ) : (
            detail.steps.map((step) => (
              <div key={step.id} className="border-b border-line py-3 last:border-b-0">
                <p className="font-medium">{step.label}</p>
                <p className="text-sm text-muted">
                  {step.status} - due {step.dueAt.toLocaleString()}
                </p>
              </div>
            ))
          )}
        </Panel>
        <Panel title="Human review">
          {detail.reviews.length === 0 ? (
            <EmptyState>No human review has been requested.</EmptyState>
          ) : (
            detail.reviews.map((review) => (
              <div key={review.id} className="border-b border-line py-3 last:border-b-0">
                <p className="font-medium">{review.reason}</p>
                <p className="text-sm text-muted">{review.summary}</p>
              </div>
            ))
          )}
        </Panel>
      </section>

      <Panel title="Contact attempts">
        {detail.attempts.length === 0 ? (
          <EmptyState>No contact attempts have been made.</EmptyState>
        ) : (
          detail.attempts.map((attempt) => (
            <div key={attempt.id} className="border-b border-line py-3 last:border-b-0">
              <p className="font-medium">
                {attempt.channel} - {attempt.outcome}
              </p>
              <p className="text-sm text-muted">{attempt.summary}</p>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Audit timeline">
        {detail.events.length === 0 ? (
          <EmptyState>No audit events have been recorded.</EmptyState>
        ) : (
          detail.events.map((event) => (
            <div key={event.id} className="border-b border-line py-3 last:border-b-0">
              <p className="font-medium">{event.type}</p>
              <p className="text-sm text-muted">{event.summary}</p>
              <p className="text-xs text-muted">{event.occurredAt.toLocaleString()}</p>
            </div>
          ))
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted">{children}</p>;
}
