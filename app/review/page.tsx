import { resolveReviewAction } from "../actions/review";
import { getReviewQueue } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const { firmUsers, reviews } = await getReviewQueue();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted">Policy-blocked workflow items that need a firm teammate.</p>
      </div>
      {reviews.length === 0 ? (
        <p className="text-sm text-muted">There are no workflow items awaiting review.</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <form key={review.id} action={resolveReviewAction} className="rounded border border-line bg-white p-4">
              <input type="hidden" name="reviewRequestId" value={review.id} />
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium">{review.reason}</p>
                <span className="rounded border border-line px-2 py-1 text-xs text-muted">{review.status}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{review.summary}</p>
              <p className="mt-2 text-xs text-muted">
                {review.runTitle} - {contextSummary(review.context)}
              </p>
              <label className="mt-3 block text-sm font-medium" htmlFor={`note-${review.id}`}>
                Reviewer note
              </label>
              <textarea
                id={`note-${review.id}`}
                name="note"
                className="mt-1 min-h-20 w-full rounded border border-line p-2 text-sm"
                defaultValue={review.recommendedAction}
              />
              <label className="mt-3 block text-sm font-medium" htmlFor={`owner-${review.id}`}>
                Owner
              </label>
              <select
                id={`owner-${review.id}`}
                name="assignedUserId"
                className="mt-1 w-full rounded border border-line bg-white p-2 text-sm"
                defaultValue={review.assignedUserId ?? ""}
              >
                <option value="">Unassigned</option>
                {firmUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded border border-line px-3 py-2 text-sm font-medium" type="submit" name="resolution" value="approved">
                  Approve and resume
                </button>
                <button className="rounded border border-line px-3 py-2 text-sm font-medium" type="submit" name="resolution" value="edited">
                  Edit and resume
                </button>
                <button className="rounded border border-line px-3 py-2 text-sm font-medium" type="submit" name="resolution" value="rejected">
                  Reject and resume
                </button>
                <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit" name="resolution" value="resolved">
                  Resolve and resume
                </button>
                <button className="rounded border border-line px-3 py-2 text-sm font-medium" type="submit" name="resolution" value="assigned">
                  Assign owner
                </button>
              </div>
            </form>
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
    .join(" | ");
}
