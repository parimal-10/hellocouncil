import Link from "next/link";
import { CheckCircle2, Inbox, PencilLine, ShieldAlert, StickyNote, UserPlus, XCircle } from "lucide-react";
import { resolveReviewAction } from "../actions/review";
import { getReviewQueue } from "@/modules/dashboard/queries";
import { Badge, Callout, Card, EmptyState, PageHeader, StatusBadge, btn, formatDateTime, humanize } from "./../components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { firmUsers, reviews } = await getReviewQueue();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human in the loop"
        title="Review queue"
        description="Policy-blocked workflow items that need a firm teammate before automation can continue."
      />

      {reviews.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox size={28} />}>
            There are no workflow items awaiting review. Automation is running unblocked.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {reviews.length} {reviews.length === 1 ? "item" : "items"} awaiting review
          </p>
          {reviews.map((review) => (
            <Card key={review.id}>
              <form action={resolveReviewAction} className="p-5">
                <input type="hidden" name="reviewRequestId" value={review.id} />

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        review.severity === "high" ? "bg-red-50 text-danger" : "bg-amber-50 text-warning"
                      }`}
                    >
                      <ShieldAlert size={18} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-ink">{humanize(review.reason)}</h2>
                        <StatusBadge status={review.severity} />
                        <StatusBadge status={review.status} />
                      </div>
                      <p className="mt-1 text-sm text-muted">{review.summary}</p>
                      <Link
                        className="mt-1 block truncate text-xs text-muted hover:text-accent"
                        href={`/workflows/${review.workflowRunId}`}
                      >
                        {review.runTitle} · {contextSummary(review.context)}
                      </Link>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted" title={review.createdAt.toLocaleString()}>
                    {formatDateTime(review.createdAt)}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_14rem]">
                  <Callout tone={review.severity === "high" ? "danger" : "warning"} title="Recommended action">
                    {review.recommendedAction}
                  </Callout>
                  <label className="block text-xs font-medium uppercase tracking-wide text-muted" htmlFor={`owner-${review.id}`}>
                    Owner
                    <select
                      id={`owner-${review.id}`}
                      name="assignedUserId"
                      defaultValue={review.assignedUserId ?? ""}
                      className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                    >
                      <option value="">Unassigned</option>
                      {firmUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-muted" htmlFor={`note-${review.id}`}>
                  Reviewer note
                  <textarea
                    id={`note-${review.id}`}
                    name="note"
                    className="mt-1 min-h-20 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-sm normal-case tracking-normal text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                    defaultValue={review.recommendedAction}
                  />
                </label>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <button className={btn.primary} name="resolution" type="submit" value="resolved">
                    <CheckCircle2 aria-hidden size={15} /> Resolve and resume
                  </button>
                  <button className={btn.secondary} name="resolution" type="submit" value="approved">
                    <CheckCircle2 aria-hidden size={15} /> Approve
                  </button>
                  <button className={btn.secondary} name="resolution" type="submit" value="edited">
                    <PencilLine aria-hidden size={15} /> Edit and resume
                  </button>
                  <button className={btn.secondary} name="resolution" type="submit" value="assigned">
                    <UserPlus aria-hidden size={15} /> Assign owner
                  </button>
                  <button className={btn.secondary} name="resolution" type="submit" value="note">
                    <StickyNote aria-hidden size={15} /> Add note only
                  </button>
                  <button className={`${btn.danger} ml-auto`} name="resolution" type="submit" value="rejected">
                    <XCircle aria-hidden size={15} /> Reject automation
                  </button>
                </div>

                {review.reviewerNote ? (
                  <p className="mt-3 text-xs text-muted">
                    <Badge tone="neutral">Last note</Badge> <span className="ml-1">{review.reviewerNote}</span>
                  </p>
                ) : null}
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function contextSummary(context: { matterName: string; clientName: string; providerName?: string; assignedUserName: string } | undefined) {
  if (!context) return "Case context unavailable";
  return [context.matterName, `Client: ${context.clientName}`, context.providerName && `Provider: ${context.providerName}`, `Owner: ${context.assignedUserName}`]
    .filter(Boolean)
    .join(" · ");
}
