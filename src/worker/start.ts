import { createBoss, jobNames, PgBossWorkflowStepScheduler } from "./boss";
import { runDueStepJob, type RunDueStepJob } from "./run-due-step";

async function main() {
  const boss = createBoss();
  await boss.start();
  const scheduler = new PgBossWorkflowStepScheduler(boss);

  await boss.work<RunDueStepJob>(jobNames.runDueStep, async ([job]) => {
    await runDueStepJob(job.data, scheduler);
  });

  console.log(`Worker listening for ${jobNames.runDueStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
