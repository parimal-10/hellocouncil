import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { MatterForm, OrganizationForm, PersonForm } from "./case-file-forms";
import { StatusBadge, humanize } from "../ui";
import { placeOutboundCallAction } from "../../actions/phone";
import { getCaseFile } from "@/modules/cases/store";

export const dynamic = "force-dynamic";

export default async function CaseFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await getCaseFile(id);
  if (!file) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm text-muted" href="/cases">
          &lt;- All cases
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{file.caseRecord.matterName}</h1>
            <p className="text-sm text-muted">Opened {formatDate(file.caseRecord.createdAt)}</p>
          </div>
          <StatusBadge status={file.caseRecord.status} />
        </div>
      </div>

      <CaseSection description="Name, status, and the firm user responsible for this case." title="Matter">
        <MatterForm
          assignedUserId={file.caseRecord.assignedUserId}
          caseId={file.caseRecord.id}
          firmUsers={file.firmUsers}
          key={`${file.caseRecord.matterName}-${file.caseRecord.status}-${file.caseRecord.assignedUserId}`}
          matterName={file.caseRecord.matterName}
          status={file.caseRecord.status}
        />
      </CaseSection>

      <section className="grid gap-4 lg:grid-cols-2">
        <CaseSection
          description="Contact details and timezone for clients and other people on the case. Roles are read-only because routing and outbound calling depend on them."
          title="People"
        >
          {file.people.length === 0 ? (
            <EmptyState>No people are linked to this case.</EmptyState>
          ) : (
            <div className="space-y-3">
              {file.people.map((person) => (
                <article className="border-t border-line pt-4 first:border-t-0 first:pt-0" key={person.id}>
                  <h3 className="mb-1 font-medium">{person.name}</h3>
                  <PersonForm
                    caseId={file.caseRecord.id}
                    key={`${person.id}-${person.name}-${person.phone}-${person.email}-${person.timeZone}`}
                    person={person}
                  />
                </article>
              ))}
            </div>
          )}
        </CaseSection>

        <CaseSection description="Providers and other organizations attached to the matter." title="Organizations">
          {file.organizations.length === 0 ? (
            <EmptyState>No organizations are linked to this case.</EmptyState>
          ) : (
            <div className="space-y-3">
              {file.organizations.map((organization) => (
                <article className="border-t border-line pt-4 first:border-t-0 first:pt-0" key={organization.id}>
                  <h3 className="mb-1 font-medium">{organization.name}</h3>
                  <OrganizationForm
                    caseId={file.caseRecord.id}
                    key={`${organization.id}-${organization.name}-${organization.type}-${organization.phone}`}
                    organization={organization}
                  />
                </article>
              ))}
            </div>
          )}
        </CaseSection>
      </section>

      <CaseSection description="Run history is recorded by the worker. Place a live Twilio call from here, or open the run for transcripts." title="Workflows">
        {file.workflows.length === 0 ? (
          <EmptyState>No workflow runs are attached to this case.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {file.workflows.map((run) => (
              <li className="py-3" key={run.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link className="font-medium" href={`/workflows/${run.id}`}>
                      {run.title}
                    </Link>
                    <p className="text-sm text-muted">
                      {humanize(run.status)} - {run.summary}
                    </p>
                  </div>
                  <form action={placeOutboundCallAction}>
                    <input name="workflowRunId" type="hidden" value={run.id} />
                    <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
                      Place Twilio call
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CaseSection>

      <section className="grid gap-4 lg:grid-cols-2">
        <CaseSection
          description="Attempts created by the worker, voice tools, or outbound phone runner."
          title="Contact Attempts"
        >
          {file.contactAttempts.length === 0 ? (
            <EmptyState>No contact attempts have been recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {file.contactAttempts.map((attempt) => (
                <li className="py-3" key={attempt.id}>
                  <p className="font-medium">
                    {humanize(attempt.channel)} - {humanize(attempt.outcome)}
                  </p>
                  <p className="text-sm text-muted">{attempt.summary}</p>
                  {attempt.syntheticResponse ? (
                    <p className="mt-1 text-xs text-muted">Response: {attempt.syntheticResponse}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">{formatDate(attempt.attemptedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CaseSection>

        <CaseSection
          description="Policy blocks and review requests that require a firm teammate."
          title="Human Reviews"
        >
          {file.reviews.length === 0 ? (
            <EmptyState>No human review has been requested for this case.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {file.reviews.map((review) => (
                <li className="py-3" key={review.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{humanize(review.reason)}</p>
                    <span className="rounded border border-line px-2 py-1 text-xs text-muted">
                      {humanize(review.status)}
                    </span>
                    <span className="rounded border border-line px-2 py-1 text-xs text-muted">
                      {humanize(review.severity)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{review.summary}</p>
                  <p className="mt-1 text-xs text-muted">Recommended: {review.recommendedAction}</p>
                  {review.reviewerNote ? <p className="mt-1 text-xs text-muted">Note: {review.reviewerNote}</p> : null}
                  <p className="mt-1 text-xs text-muted">{formatDate(review.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CaseSection>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <CaseSection description="Outbound phone-call records attached to this case." title="Phone Calls">
          {file.phoneCalls.length === 0 ? (
            <EmptyState>No outbound phone calls have been placed for this case.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {file.phoneCalls.map((call) => (
                <li className="py-3" key={call.id}>
                  <p className="font-medium">
                    {call.toNumber} - {humanize(call.connectionStatus)}
                  </p>
                  <p className="text-sm text-muted">
                    From {call.fromNumber}
                    {call.twilioCallStatus ? ` - Twilio: ${humanize(call.twilioCallStatus)}` : ""}
                    {call.answeredBy ? ` - Answered by ${call.answeredBy}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(call.createdAt)} in {call.timeZone}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CaseSection>

        <CaseSection description="Append-only workflow events for this case." title="Audit Timeline">
          {file.auditEvents.length === 0 ? (
            <EmptyState>No audit events have been recorded for this case.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {file.auditEvents.map((event) => (
                <li className="py-3" key={event.id}>
                  <p className="font-medium">{event.type}</p>
                  <p className="text-sm text-muted">{event.summary}</p>
                  <p className="mt-1 text-xs text-muted">
                    {humanize(event.actorType)} - {formatDate(event.occurredAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CaseSection>
      </section>
    </div>
  );
}

function CaseSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-line bg-white p-4">
      <h2 className="mb-1 font-semibold">{title}</h2>
      <p className="mb-4 text-sm text-muted">{description}</p>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
