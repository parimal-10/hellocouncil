import "dotenv/config";
import { PgBoss } from "pg-boss";
import type { WorkflowStepScheduler } from "@/modules/workflows/engine";

export const jobNames = {
  runDueStep: "workflow.run-due-step",
} as const;

export function createBoss() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  return new PgBoss({
    connectionString,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });
}

export async function configureWorkflowQueues(boss: Pick<PgBoss, "createQueue">): Promise<void> {
  await boss.createQueue(jobNames.runDueStep, { policy: "key_strict_fifo" });
}

export class PgBossWorkflowStepScheduler implements WorkflowStepScheduler {
  constructor(private readonly boss: Pick<PgBoss, "send">) {}

  async scheduleDueStep(input: { stepId: string; runAt: Date }): Promise<string> {
    const singletonKey = `${jobNames.runDueStep}:${input.stepId}`;
    const jobId = await this.boss.send(
      jobNames.runDueStep,
      { stepId: input.stepId },
      { singletonKey, startAfter: input.runAt },
    );
    if (!jobId) throw new Error("Due-step scheduler did not return a job id.");
    return jobId;
  }
}
