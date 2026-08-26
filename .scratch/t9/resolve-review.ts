import "dotenv/config";
import { pool } from "@/db/client";
import { WorkflowEngine } from "@/modules/workflows/engine";
import { workflowDefinitions } from "@/modules/workflows/definitions";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
import { signalRun } from "@/temporal/start-run";

const [reviewRequestId, resolution, note] = process.argv.slice(2);
if (!reviewRequestId || !resolution) {
  throw new Error("usage: tsx resolve-review.ts <reviewRequestId> <approved|rejected> [note]");
}
const store = new DrizzleWorkflowStore();
const reviewBefore = await store.getReview(reviewRequestId);
const engine = new WorkflowEngine({ store, definitions: workflowDefinitions });
const result = await engine.applyAction({
  type: "resolve_blocked_step",
  reviewRequestId,
  resolution: resolution as "approved" | "rejected",
  note: note ?? "T9 verification review resolution.",
});
await signalRun({
  workflowRunId: reviewBefore.workflowRunId,
  signal: "reviewResolved",
  args: [],
});
console.log(JSON.stringify({ result, workflowRunId: reviewBefore.workflowRunId }));
await pool.end();
