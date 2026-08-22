import Link from "next/link";
import { AlertCircle, CalendarClock, History, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { getDashboardData } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operations dashboard</h1>
        <p className="text-sm text-muted">Long-running agent workflows across active cases.</p>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric icon={<Workflow size={18} />} label="Active runs" value={data.counts.activeRuns} />
        <Metric icon={<AlertCircle size={18} />} label="Blocked runs" value={data.counts.blockedRuns} />
        <Metric icon={<AlertCircle size={18} />} label="Open reviews" value={data.counts.openReviews} />
        <Metric icon={<CalendarClock size={18} />} label="Due steps" value={data.counts.dueSteps} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel title="Workflow runs">
          {data.runs.length === 0 ? (
            <EmptyState>There are no workflow runs yet.</EmptyState>
          ) : (
            <div className="divide-y divide-line">
              {data.runs.map((run) => (
                <Link key={run.id} href={`/workflows/${run.id}`} className="block py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">{run.title}</p>
                      <p className="truncate text-sm text-muted">{run.summary}</p>
                    </div>
                    <Status status={run.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Blocked review items">
          {data.reviews.length === 0 ? (
            <EmptyState>No workflow items are awaiting review.</EmptyState>
          ) : (
            <div className="divide-y divide-line">
              {data.reviews.map((review) => (
                <div key={review.id} className="py-3">
                  <p className="font-medium">{review.reason}</p>
                  <p className="text-sm text-muted">{review.summary}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="Recent audit events" icon={<History size={18} />}>
        {data.events.length === 0 ? (
          <EmptyState>No audit events have been recorded.</EmptyState>
        ) : (
          <div className="divide-y divide-line">
            {data.events.map((event) => (
              <div key={event.id} className="py-3">
                <p className="font-medium">{event.type}</p>
                <p className="text-sm text-muted">{event.summary}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted">{children}</p>;
}

function Status({ status }: { status: string }) {
  return <span className="shrink-0 rounded border border-line px-2 py-1 text-xs text-muted">{status}</span>;
}
