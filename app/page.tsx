import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  History,
  PhoneOutgoing,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { getDashboardData } from "@/modules/dashboard/queries";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
  formatDateTime,
  humanize,
  relativeTime,
} from "./components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Operations dashboard"
        description="Long-running agent workflows across active cases, with autonomous outreach and human review in one place."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={<Workflow size={16} />} tone="accent" label="Active runs" value={data.counts.activeRuns} />
        <Metric icon={<AlertTriangle size={16} />} tone="warning" label="Blocked runs" value={data.counts.blockedRuns} />
        <Metric icon={<ClipboardCheck size={16} />} tone="danger" label="Open reviews" value={data.counts.openReviews} />
        <Metric icon={<CalendarClock size={16} />} tone="info" label="Due now" value={data.counts.dueSteps} />
        <Metric icon={<PhoneOutgoing size={16} />} tone="neutral" label="Upcoming" value={data.counts.upcomingSteps} />
      </section>

      {data.counts.workflowTypes.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-medium text-ink">Runs by workflow</span>
          {data.counts.workflowTypes.map((item) => (
            <span
              className="rounded-full border border-line bg-white px-2.5 py-1 font-medium"
              key={item.definitionId}
            >
              {humanize(item.definitionId)} · {item.value}
            </span>
          ))}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Workflow runs"
            icon={<Workflow size={15} />}
            action={{ href: "/cases", label: "View cases" }}
          />
          {data.runs.length === 0 ? (
            <EmptyState icon={<Workflow size={28} />}>There are no workflow runs yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {data.runs.map((run) => (
                <li key={run.id}>
                  <Link
                    className="group flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-panel/70"
                    href={`/workflows/${run.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{run.title}</p>
                      <p className="truncate text-sm text-muted">{run.summary || "No update recorded yet."}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{contextSummary(run.context)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={run.status} />
                      <ChevronRight
                        aria-hidden
                        className="text-slate-300 transition-colors group-hover:text-accent"
                        size={16}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Blocked review items"
            icon={<ClipboardCheck size={15} />}
            action={{ href: "/review", label: "Open review queue" }}
          />
          {data.reviews.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={28} />}>
              No workflow items are awaiting review.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {data.reviews.map((review) => (
                <li className="px-5 py-3.5" key={review.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={review.severity} />
                    <span className="text-sm font-medium text-ink">{humanize(review.reason)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{review.summary}</p>
                  <Link
                    className="mt-0.5 block truncate text-xs text-muted hover:text-accent"
                    href={`/workflows/${review.workflowRunId}`}
                  >
                    {review.runTitle} · {contextSummary(review.context)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <StepList
          icon={<CalendarClock size={15} />}
          title="Due now and overdue"
          emptyMessage="No follow-ups are currently due."
          steps={data.dueSteps.map((step) => ({
            id: step.id,
            href: `/workflows/${step.workflowRunId}`,
            label: step.label,
            sub: step.runTitle,
            context: contextSummary(step.context),
            dueAt: step.dueAt,
          }))}
        />
        <StepList
          icon={<CalendarClock size={15} />}
          title="Upcoming follow-ups"
          emptyMessage="No future follow-ups are scheduled."
          steps={data.upcomingSteps.map((step) => ({
            id: step.id,
            href: `/workflows/${step.workflowRunId}`,
            label: step.label,
            sub: step.runTitle,
            context: contextSummary(step.context),
            dueAt: step.dueAt,
          }))}
        />
      </section>

      <Card>
        <CardHeader title="Recent audit events" icon={<History size={15} />} />
        {data.events.length === 0 ? (
          <EmptyState icon={<History size={28} />}>No audit events have been recorded.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.events.map((event) => (
              <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-5 py-3" key={event.id}>
                <code className="rounded bg-panel px-1.5 py-0.5 text-xs font-medium text-accent">
                  {event.type}
                </code>
                <span className="text-sm text-muted">{event.summary}</span>
                <span className="ml-auto shrink-0 text-xs text-muted" title={event.occurredAt.toLocaleString()}>
                  {relativeTime(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "accent" | "warning" | "danger" | "info" | "neutral";
}) {
  const tones = {
    accent: "bg-teal-50 text-teal-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-red-50 text-red-600",
    info: "bg-blue-50 text-blue-700",
    neutral: "bg-slate-100 text-slate-600",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</div>
    </Card>
  );
}

function StepList({
  title,
  icon,
  emptyMessage,
  steps,
}: {
  title: string;
  icon: ReactNode;
  emptyMessage: string;
  steps: Array<{ id: string; href: string; label: string; sub: string; context: string; dueAt: Date }>;
}) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      {steps.length === 0 ? (
        <EmptyState icon={<CalendarClock size={28} />}>{emptyMessage}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {steps.map((step) => (
            <li key={step.id}>
              <Link
                className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-panel/70"
                href={step.href}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{step.label}</p>
                  <p className="truncate text-xs text-muted">
                    {step.sub} · {step.context}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-medium text-ink" title={step.dueAt.toLocaleString()}>
                    {formatDateTime(step.dueAt)}
                  </p>
                  <p className="text-xs text-muted">{relativeTime(step.dueAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function contextSummary(context: { matterName: string; clientName: string; providerName?: string; assignedUserName: string } | undefined) {
  if (!context) return "Case context unavailable";
  return [context.matterName, `Client: ${context.clientName}`, context.providerName && `Provider: ${context.providerName}`, `Owner: ${context.assignedUserName}`]
    .filter(Boolean)
    .join(" · ");
}
