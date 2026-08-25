import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ClipboardCheck,
  History,
  Phone,
  PhoneOutgoing,
  Users,
} from "lucide-react";
import { MatterForm, OrganizationForm, PersonForm } from "./case-file-forms";
import { StatusBadge, humanize } from "../ui";
import { placeOutboundCallAction } from "../../actions/phone";
import { getCaseFile } from "@/modules/cases/store";
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Timeline,
  btn,
  formatDateTime,
} from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function CaseFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = await getCaseFile(id);
  if (!file) notFound();

  return (
    <div className="space-y-6">
      <Link className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent" href="/cases">
        <ArrowLeft aria-hidden size={15} /> All cases
      </Link>

      <PageHeader
        eyebrow="Case file"
        title={file.caseRecord.matterName}
        description={`Opened ${formatDateTime(file.caseRecord.createdAt)}`}
        actions={<StatusBadge status={file.caseRecord.status} />}
      />

      <Card>
        <CardHeader
          title="Matter"
          description="Name, status, and the firm user responsible for this case."
        />
        <div className="px-5 py-4">
          <MatterForm
            assignedUserId={file.caseRecord.assignedUserId}
            caseId={file.caseRecord.id}
            firmUsers={file.firmUsers}
            key={`${file.caseRecord.matterName}-${file.caseRecord.status}-${file.caseRecord.assignedUserId}`}
            matterName={file.caseRecord.matterName}
            status={file.caseRecord.status}
          />
        </div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="People"
            icon={<Users size={15} />}
            description="Contact details for people on the case. Roles are read-only because outbound calling depends on them."
          />
          <div className="divide-y divide-line px-5 py-2">
            {file.people.length === 0 ? (
              <EmptyState icon={<Users size={28} />}>No people are linked to this case.</EmptyState>
            ) : (
              file.people.map((person) => (
                <article className="py-4 first:pt-3 last:pb-3" key={person.id}>
                  <div className="mb-2 flex items-center gap-3">
                    <Avatar name={person.name} tone={person.participantRole === "client" ? "accent" : "neutral"} />
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{person.name}</h3>
                      <p className="text-xs text-muted">{humanize(person.participantRole)}</p>
                    </div>
                  </div>
                  <PersonForm
                    caseId={file.caseRecord.id}
                    key={`${person.id}-${person.name}-${person.phone}-${person.email}-${person.timeZone}`}
                    person={person}
                  />
                </article>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Organizations"
            icon={<Building2 size={15} />}
            description="Providers and other organizations attached to the matter."
          />
          <div className="divide-y divide-line px-5 py-2">
            {file.organizations.length === 0 ? (
              <EmptyState icon={<Building2 size={28} />}>No organizations are linked to this case.</EmptyState>
            ) : (
              file.organizations.map((organization) => (
                <article className="py-4 first:pt-3 last:pb-3" key={organization.id}>
                  <div className="mb-2 flex items-center gap-3">
                    <Avatar name={organization.name} tone="info" />
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{organization.name}</h3>
                      <p className="text-xs text-muted">{humanize(organization.participantRole)}</p>
                    </div>
                  </div>
                  <OrganizationForm
                    caseId={file.caseRecord.id}
                    key={`${organization.id}-${organization.name}-${organization.type}-${organization.phone}`}
                    organization={organization}
                  />
                </article>
              ))
            )}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Workflows"
          icon={<PhoneOutgoing size={15} />}
          description="Run history is recorded by the worker. Place a live Twilio call from here, or open the run for transcripts."
        />
        {file.workflows.length === 0 ? (
          <EmptyState icon={<PhoneOutgoing size={28} />}>No workflow runs are attached to this case.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {file.workflows.map((run) => (
              <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" key={run.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="truncate text-sm font-medium text-ink hover:text-accent" href={`/workflows/${run.id}`}>
                      {run.title}
                    </Link>
                    <StatusBadge status={run.status} />
                  </div>
                  <p className="mt-0.5 text-sm text-muted">{run.summary}</p>
                </div>
                <form action={placeOutboundCallAction}>
                  <input name="workflowRunId" type="hidden" value={run.id} />
                  <button className={btn.primary} type="submit">
                    <Phone aria-hidden size={14} /> Place call
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Contact attempts"
            icon={<Phone size={15} />}
            description="Attempts created by the worker, voice tools, or outbound phone runner."
          />
          {file.contactAttempts.length === 0 ? (
            <EmptyState icon={<Phone size={28} />}>No contact attempts have been recorded.</EmptyState>
          ) : (
            <Timeline
              items={[...file.contactAttempts].reverse().map((attempt) => ({
                id: attempt.id,
                title: `${humanize(attempt.channel)} · ${humanize(attempt.outcome)}`,
                badge: <StatusBadge status={attempt.outcome} />,
                body: attempt.summary,
                meta: formatDateTime(attempt.attemptedAt),
                dotTone: attempt.outcome === "reached" ? "success" : attempt.outcome === "failed" || attempt.outcome === "refused" ? "danger" : "warning",
              }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Human reviews"
            icon={<ClipboardCheck size={15} />}
            description="Policy blocks and review requests that require a firm teammate."
          />
          {file.reviews.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={28} />}>No human review has been requested for this case.</EmptyState>
          ) : (
            <Timeline
              items={[...file.reviews].reverse().map((review) => ({
                id: review.id,
                title: humanize(review.reason),
                badge: (
                  <>
                    <StatusBadge status={review.severity} />
                    <StatusBadge status={review.status} />
                  </>
                ),
                body: (
                  <>
                    {review.summary}
                    <span className="mt-0.5 block text-xs">Recommended: {review.recommendedAction}</span>
                    {review.reviewerNote ? <span className="mt-0.5 block text-xs">Note: {review.reviewerNote}</span> : null}
                  </>
                ),
                meta: formatDateTime(review.createdAt),
                dotTone: review.severity === "high" ? "danger" : "warning",
              }))}
            />
          )}
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Phone calls"
            icon={<PhoneOutgoing size={15} />}
            description="Outbound phone-call records attached to this case."
          />
          {file.phoneCalls.length === 0 ? (
            <EmptyState icon={<PhoneOutgoing size={28} />}>No outbound phone calls have been placed for this case.</EmptyState>
          ) : (
            <Timeline
              items={[...file.phoneCalls].reverse().map((call) => ({
                id: call.id,
                title: `${call.toNumber} · ${humanize(call.connectionStatus)}`,
                badge: <StatusBadge status={call.connectionStatus} />,
                body: [
                  `From ${call.fromNumber}`,
                  call.twilioCallStatus ? `Twilio: ${humanize(call.twilioCallStatus)}` : null,
                  call.answeredBy ? `Answered by ${call.answeredBy}` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
                meta: `${formatDateTime(call.createdAt)} · ${call.timeZone}`,
                dotTone: call.connectionStatus === "answered" ? "success" : "neutral",
              }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Audit timeline"
            icon={<History size={15} />}
            description="Append-only workflow events for this case."
          />
          {file.auditEvents.length === 0 ? (
            <EmptyState icon={<History size={28} />}>No audit events have been recorded for this case.</EmptyState>
          ) : (
            <Timeline
              items={[...file.auditEvents].reverse().map((event) => ({
                id: event.id,
                title: event.type,
                body: event.summary,
                meta: `${humanize(event.actorType)} · ${formatDateTime(event.occurredAt)}`,
                dotTone: event.type.includes("fail") ? "danger" : event.type.startsWith("review") ? "warning" : event.type.includes("completed") ? "success" : "accent",
              }))}
            />
          )}
        </Card>
      </section>
    </div>
  );
}

