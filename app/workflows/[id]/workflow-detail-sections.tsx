import React, { type ReactNode } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  History,
  ListChecks,
  PhoneOutgoing,
  Sparkles,
} from "lucide-react";
import { OutboundCallPanel } from "./outbound-call-panel";
import { getWorkflowDetail } from "@/modules/dashboard/queries";
import { loadOutboundCallContext, DrizzlePhoneCallStore } from "@/modules/phone/store";
import type { OutboundCallContext, PhoneCallRecord } from "@/modules/phone/types";
import { buildWorkflowBriefing, type WorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";
import type { WorkflowDefinition, WorkflowDefinitionId } from "@/modules/workflows/types";
import {
  Callout,
  Card,
  CardHeader,
  EmptyState,
  StatusBadge,
  Timeline,
  formatDateTime,
  humanize,
} from "../../components/ui";

type WorkflowDetail = NonNullable<Awaited<ReturnType<typeof getWorkflowDetail>>>;

export type WorkflowDetailSectionData = {
  detail: WorkflowDetail;
  definition: WorkflowDefinition;
  briefing: WorkflowBriefing;
  callContext: OutboundCallContext | null;
  phoneCalls: PhoneCallRecord[];
};

export async function loadWorkflowDetailSectionData(workflowRunId: string): Promise<WorkflowDetailSectionData | null> {
  const detail = await getWorkflowDetail(workflowRunId);
  if (!detail) return null;

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
    loadOutboundCallContext(workflowRunId).catch(() => null),
    phoneStore.listCallsForRun(workflowRunId),
  ]);

  return { detail, definition, briefing, callContext, phoneCalls };
}

export function WorkflowDetailSections({
  detail,
  briefing,
  callContext,
  phoneCalls,
  afterOutbound,
}: Omit<WorkflowDetailSectionData, "definition"> & {
  afterOutbound?: ReactNode;
}) {
  return (
    <>
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
                    {briefing.nextFollowUp.label} - {formatDateTime(briefing.nextFollowUp.dueAt)} (
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

      {afterOutbound}

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
                  title: `${humanize(attempt.channel)} - ${humanize(attempt.outcome)}`,
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
    </>
  );
}

export function relativeFromNow(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  if (absMinutes < 1) return "now";
  if (absMinutes < 60) return diffMs > 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diffMs > 0 ? `in ${days}d` : `${days}d ago`;
}
