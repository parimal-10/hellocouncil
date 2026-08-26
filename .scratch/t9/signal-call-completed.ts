import "dotenv/config";
import { pool } from "@/db/client";
import { signalRun } from "@/temporal/start-run";

const [workflowRunId, callId] = process.argv.slice(2);
if (!workflowRunId || !callId) throw new Error("usage: tsx signal-call-completed.ts <workflowRunId> <callId>");
await signalRun({ workflowRunId, signal: "callCompleted", args: [{ callId }] });
console.log(JSON.stringify({ signaled: true, workflowRunId, callId }));
await pool.end();
