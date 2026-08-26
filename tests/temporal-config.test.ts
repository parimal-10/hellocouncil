import { afterEach, describe, expect, it } from "vitest";
import { TASK_QUEUE, loadTemporalConfig } from "@/temporal/config";

describe("temporal runtime config", () => {
  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    delete process.env.TEMPORAL_NAMESPACE;
  });

  it("defaults to the local self-hosted server and hellocouncil namespace", () => {
    expect(loadTemporalConfig()).toEqual({
      address: "localhost:7233",
      namespace: "hellocouncil",
      taskQueue: TASK_QUEUE,
    });
    expect(TASK_QUEUE).toBe("hellocouncil-workflows");
  });

  it("reads overrides from the environment", () => {
    process.env.TEMPORAL_ADDRESS = "temporal:7233";
    process.env.TEMPORAL_NAMESPACE = "other";
    expect(loadTemporalConfig()).toMatchObject({ address: "temporal:7233", namespace: "other" });
  });
});
