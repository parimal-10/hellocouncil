import { configureWorkflowQueues, createBoss, jobNames, PgBossWorkflowStepScheduler } from "./boss";
import { isAutomaticOutboundCallingEnabled } from "@/modules/phone/auto-dial";
import { createWorkerOutboundDialer } from "@/modules/phone/worker-dialer";
import { DrizzleWorkflowStore } from "@/modules/workflows/store";
import { reconcileDueSteps } from "./reconcile-due-steps";
import { runDueStepJob, type RunDueStepJob } from "./run-due-step";
import type { OutboundFollowUpPort } from "@/modules/workflows/engine";

function loadOutboundCaller(): OutboundFollowUpPort {
  if (!isAutomaticOutboundCallingEnabled()) {
    throw new Error(
      "AUTO_OUTBOUND_CALLS=true is required. Due follow-ups place real Twilio calls; there is no simulated fallback.",
    );
  }
  return createWorkerOutboundDialer();
}

async function main() {
  const outboundCaller = loadOutboundCaller();
  console.log("Automatic outbound calling is enabled. Due phone follow-ups place Twilio calls.");

  const boss = createBoss();
  await boss.start();
  await configureWorkflowQueues(boss);
  const scheduler = new PgBossWorkflowStepScheduler(boss);
  const store = new DrizzleWorkflowStore();
  const reconcile = () => reconcileDueSteps({ store, scheduler, now: new Date() });

  await reconcile();
  setInterval(() => {
    void reconcile().catch((error) => console.error("Due-step reconciliation failed.", error));
  }, 60_000);

  await boss.work<RunDueStepJob>(jobNames.runDueStep, async ([job]) => {
    await runDueStepJob(job.data, scheduler, outboundCaller);
  });

  console.log(`Worker listening for ${jobNames.runDueStep}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
