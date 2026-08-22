import { createBoss, jobNames } from "./boss";
import { runDueStepJob, type RunDueStepJob } from "./run-due-step";

async function main() {
  const boss = createBoss();
  await boss.start();

  await boss.work<RunDueStepJob>(jobNames.runDueStep, async ([job]) => {
    await runDueStepJob(job.data);
  });

  console.log(`Worker listening for ${jobNames.runDueStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
