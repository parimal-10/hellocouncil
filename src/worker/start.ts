import { createBoss, jobNames, PgBossWorkflowStepScheduler } from "./boss";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
import { reconcileDueSteps } from "./reconcile-due-steps";
import { runDueStepJob, type RunDueStepJob } from "./run-due-step";

async function main() {
  const boss = createBoss();
  await boss.start();
  const scheduler = new PgBossWorkflowStepScheduler(boss);
  const store = new DrizzleWorkflowStore();
  const reconcile = () => reconcileDueSteps({ store, scheduler, now: new Date() });

  await reconcile();
  setInterval(() => {
    void reconcile().catch((error) => console.error("Due-step reconciliation failed.", error));
  }, 60_000);

  await boss.work<RunDueStepJob>(jobNames.runDueStep, async ([job]) => {
    await runDueStepJob(job.data, scheduler);
  });

  console.log(`Worker listening for ${jobNames.runDueStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
