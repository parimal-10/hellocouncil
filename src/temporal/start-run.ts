import { workflowRunWorkflow, workflowSignals } from "./workflows/workflow-run";
import type { SignalDefinition } from "@temporalio/workflow";
import { getTemporalClient, workflowIdFor } from "./client";
import { loadTemporalConfig } from "./config";
import { recordTemporalWorkflowId } from "./activities";

export async function startWorkflowRun(input: { workflowRunId: string }): Promise<string> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start(workflowRunWorkflow, {
    args: [{ workflowRunId: input.workflowRunId }],
    workflowId: workflowIdFor(input.workflowRunId),
    taskQueue: loadTemporalConfig().taskQueue,
  });
  await recordTemporalWorkflowId({
    workflowRunId: input.workflowRunId,
    temporalWorkflowId: handle.firstExecutionRunId,
  });
  return handle.firstExecutionRunId;
}

export async function signalRun(options: {
  workflowRunId: string;
  signal: keyof typeof workflowSignals;
  args: unknown[];
}): Promise<void> {
  const client = await getTemporalClient();
  await client.workflow.signalWithStart(workflowRunWorkflow, {
    args: [{ workflowRunId: options.workflowRunId }],
    workflowId: workflowIdFor(options.workflowRunId),
    taskQueue: loadTemporalConfig().taskQueue,
    signal: workflowSignals[options.signal] as SignalDefinition<unknown[]>,
    signalArgs: options.args as unknown[],
  });
}
