import { resolveReviewAction } from "../actions/review";
import { getOpenReviews } from "@/modules/dashboard/queries";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const reviews = await getOpenReviews();

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
              <input type="hidden" name="workflowRunId" value={review.workflowRunId} />
              <input type="hidden" name="reviewRequestId" value={review.id} />
              <input type="hidden" name="resolution" value="resolved" />
              <p className="font-medium">{review.reason}</p>
              <p className="mt-1 text-sm text-muted">{review.summary}</p>
              <label className="mt-3 block text-sm font-medium" htmlFor={`note-${review.id}`}>
                Reviewer note
              </label>
              <textarea
                id={`note-${review.id}`}
                name="note"
                className="mt-1 min-h-20 w-full rounded border border-line p-2 text-sm"
                defaultValue={review.recommendedAction}
              />
              <button className="mt-3 rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">
                Resolve blocked step
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
