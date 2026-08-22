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

export async function configureWorkflowQueues(boss: Pick<PgBoss, "createQueue" | "getQueue">): Promise<void> {
  const policy = "key_strict_fifo";
  await boss.createQueue(jobNames.runDueStep, { policy });

  const queue = await boss.getQueue(jobNames.runDueStep);
  if (queue?.policy !== policy) {
    throw new Error(`${jobNames.runDueStep} queue must use ${policy}; found ${queue?.policy ?? "no queue"}.`);
  }
}

export class PgBossWorkflowStepScheduler implements WorkflowStepScheduler {
  constructor(private readonly boss: PgBoss) {}

  async scheduleDueStep(input: { stepId: string; runAt: Date }): Promise<string> {
    const singletonKey = `${jobNames.runDueStep}:${input.stepId}`;
    const { jobs } = await this.boss.upsert(jobNames.runDueStep, { stepId: input.stepId }, { singletonKey, startAfter: input.runAt });
    const [jobId] = jobs;
    if (!jobId) throw new Error("pg-boss did not create a due-step job.");
    return jobId;
  }
}
