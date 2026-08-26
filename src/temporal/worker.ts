import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { loadTemporalConfig } from "./config";
import { isAutomaticOutboundCallingEnabled } from "@/modules/phone/auto-dial";

async function main() {
  if (!isAutomaticOutboundCallingEnabled()) {
    throw new Error(
      "AUTO_OUTBOUND_CALLS=true is required. Due follow-ups place real Twilio calls; there is no simulated fallback.",
    );
  }
  console.log("Automatic outbound calling is enabled. Due phone follow-ups place Twilio calls.");

  const config = loadTemporalConfig();
  const workflowsPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "workflows",
    "workflow-run.ts",
  );
  const worker = await Worker.create({
    workflowsPath,
    activities,
    taskQueue: config.taskQueue,
    namespace: config.namespace,
  });
  console.log(`Temporal worker listening on ${config.address} [${config.namespace}] queue=${config.taskQueue}`);
  await worker.run();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
