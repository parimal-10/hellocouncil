import { Client, Connection } from "@temporalio/client";
import { loadTemporalConfig } from "./config";

let cached: Promise<Client> | undefined;

export async function getTemporalClient() {
  if (!cached) {
    cached = (async () => {
      const config = loadTemporalConfig();
      const connection = await Connection.connect({ address: config.address });
      return new Client({ connection, namespace: config.namespace });
    })();
  }
  return cached;
}

export function workflowIdFor(workflowRunId: string): string {
  return `workflow-run-${workflowRunId}`;
}
