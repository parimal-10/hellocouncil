import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getWorkflowDetail } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getWorkflowDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{detail.run.title}</h1>
        <p className="text-sm text-muted">
          {detail.caseRecord?.matterName ?? "Unknown case"} - {detail.run.status}
        </p>
      </div>

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
