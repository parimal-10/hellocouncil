import "dotenv/config";
import { pool } from "@/db/client";
import { executeVoiceWorkflowTool } from "@/voice-agent/tools";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";

const [workflowRunId, dueAtIso] = process.argv.slice(2);
if (!workflowRunId || !dueAtIso) throw new Error("usage: tsx schedule-follow-up.ts <workflowRunId> <dueAtIso>");
const result = await executeVoiceWorkflowTool({
  workflowRunId,
  toolName: "schedule_follow_up",
  payload: { dueAt: dueAtIso, reason: "T9 timer durability test follow-up." },
  store: new DrizzleWorkflowStore(),
});
console.log(JSON.stringify(result));
await pool.end();
