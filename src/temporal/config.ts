export const TASK_QUEUE = "hellocouncil-workflows";

export type TemporalRuntimeConfig = { address: string; namespace: string; taskQueue: string };

export function loadTemporalConfig(): TemporalRuntimeConfig {
  return {
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    namespace: process.env.TEMPORAL_NAMESPACE ?? "hellocouncil",
    taskQueue: TASK_QUEUE,
  };
}
