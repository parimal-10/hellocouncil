import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  History,
  ListChecks,
  PhoneOutgoing,
  Sparkles,
} from "lucide-react";
import { LiveKitVoiceLauncher } from "../../voice/livekit-room";
import { OutboundCallPanel } from "./outbound-call-panel";
import { getWorkflowDetail } from "@/modules/dashboard/queries";
import { loadOutboundCallContext, DrizzlePhoneCallStore } from "@/modules/phone/store";
import { buildWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowDefinitionId } from "@/modules/workflows/types";
import {
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
  Timeline,
  formatDateTime,
  humanize,
} from "../../components/ui";

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
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent"
        href={detail.caseRecord ? `/cases/${detail.caseRecord.id}` : "/cases"}
      >
        <ArrowLeft aria-hidden size={15} /> {detail.caseRecord ? "Back to case file" : "All cases"}
      </Link>

      <PageHeader
        eyebrow={definition.label}
        title={detail.context?.matterName ?? detail.run.title}
        description={
          detail.context
            ? `Client: ${detail.context.clientName}${detail.context.providerName ? ` · Provider: ${detail.context.providerName}` : ""} · Owner: ${detail.context.assignedUserName}`
            : detail.caseRecord?.matterName ?? undefined
        }
        actions={<StatusBadge status={detail.run.status} />}
      />

      <Card>
        <CardHeader title="Current status" icon={<Sparkles size={15} />} />
        <div className="px-5 py-4">
          <p className="text-sm text-ink">{briefing.currentStatus}</p>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">What has happened</h3>
              {briefing.whatHappened.length === 0 ? (
                <EmptyState>No history has been recorded yet.</EmptyState>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {briefing.whatHappened.map((item) => (
                    <li className="flex items-start gap-2 text-sm text-muted" key={item}>
                      <CheckCircle2 aria-hidden className="mt-0.5 shrink-0 text-teal-600" size={14} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Next steps</h3>
              {briefing.nextSteps.length === 0 ? (
                <EmptyState>No next steps are planned.</EmptyState>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {briefing.nextSteps.map((item) => (
                    <li className="flex items-start gap-2 text-sm text-muted" key={item}>
                      <ListChecks aria-hidden className="mt-0.5 shrink-0 text-blue-600" size={14} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {briefing.nextFollowUp ? (
                <div className="mt-3">
                  <Callout tone="info" title="Next follow-up">
                    {briefing.nextFollowUp.label} · {formatDateTime(briefing.nextFollowUp.dueAt)} (
                    {relativeFromNow(briefing.nextFollowUp.dueAt)})
                  </Callout>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">No follow-up is currently scheduled.</p>
              )}
            </div>
          </div>
        </div>
      </Card>

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

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Steps" icon={<CalendarClock size={15} />} />
          <div className="px-5 py-4">
            {detail.steps.length === 0 ? (
              <EmptyState icon={<CalendarClock size={28} />}>No workflow steps have been scheduled.</EmptyState>
            ) : (
              <Timeline
                items={[...detail.steps].reverse().map((step) => ({
                  id: step.id,
                  title: step.label,
                  badge: <StatusBadge status={step.status} />,
                  meta: `Due ${formatDateTime(step.dueAt)} (${relativeFromNow(step.dueAt)})`,
                  dotTone:
                    step.status === "completed"
                      ? "success"
                      : step.status === "waiting_for_human"
                        ? "warning"
                        : step.status === "failed" || step.status === "skipped"
                          ? "danger"
                          : step.status === "running"
                            ? "info"
                            : "accent",
                }))}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Human review" icon={<ClipboardCheck size={15} />} />
          <div className="px-5 py-4">
            {detail.reviews.length === 0 ? (
              <EmptyState icon={<ClipboardCheck size={28} />}>No human review has been requested.</EmptyState>
            ) : (
              <Timeline
                items={[...detail.reviews].reverse().map((review) => ({
                  id: review.id,
                  title: humanize(review.reason),
                  badge: (
                    <>
                      <StatusBadge status={review.severity} />
                      <StatusBadge status={review.status} />
                    </>
                  ),
                  body: review.summary,
                  dotTone: review.severity === "high" ? "danger" : "warning",
                }))}
              />
            )}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Contact attempts" icon={<PhoneOutgoing size={15} />} />
          <div className="px-5 py-4">
            {detail.attempts.length === 0 ? (
              <EmptyState icon={<PhoneOutgoing size={28} />}>No contact attempts have been made.</EmptyState>
            ) : (
              <Timeline
                items={[...detail.attempts].reverse().map((attempt) => ({
                  id: attempt.id,
                  title: `${humanize(attempt.channel)} · ${humanize(attempt.outcome)}`,
                  badge: <StatusBadge status={attempt.outcome} />,
                  body: attempt.summary,
                  dotTone:
                    attempt.outcome === "reached"
                      ? "success"
                      : attempt.outcome === "failed" || attempt.outcome === "refused"
                        ? "danger"
                        : "warning",
                }))}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Audit timeline" icon={<History size={15} />} />
          <div className="px-5 py-4">
            {detail.events.length === 0 ? (
              <EmptyState icon={<History size={28} />}>No audit events have been recorded.</EmptyState>
            ) : (
              <Timeline
                items={[...detail.events].reverse().map((event) => ({
                  id: event.id,
                  title: event.type,
                  body: event.summary,
                  meta: formatDateTime(event.occurredAt),
                  dotTone: event.type.includes("fail")
                    ? "danger"
                    : event.type.startsWith("review")
                      ? "warning"
                      : event.type.includes("completed")
                        ? "success"
                        : event.type === "scheduling.decision"
                          ? "info"
                          : "accent",
                }))}
              />
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}

function relativeFromNow(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  if (absMinutes < 1) return "now";
  if (absMinutes < 60) return diffMs > 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diffMs > 0 ? `in ${days}d` : `${days}d ago`;
}
