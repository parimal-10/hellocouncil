// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { parseCaseUpdate, parseOrganizationUpdate, parsePersonUpdate } from "@/modules/cases/update";

const state = vi.hoisted(() => ({ inserts: [] as Array<{ table: string; values: unknown }> }));

vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "firm-user-1" }],
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (value: unknown) => {
          state.inserts.push({ table: getTableName(table as never), values: value });
          return { returning: async () => [{ id: "generated-id" }] };
        },
      }),
    },
  };
});

import { createCaseRecord } from "@/modules/cases/store";

describe("legal context updates", () => {
  it("accepts editable case fields and rejects an empty matter name", () => {
    expect(
      parseCaseUpdate({
        matterName: "  Lee v. Metro Transit  ",
        status: "on_hold",
        assignedUserId: "user-1",
      }),
    ).toEqual({
      ok: true,
      value: {
        matterName: "Lee v. Metro Transit",
        status: "on_hold",
        assignedUserId: "user-1",
      },
    });

    expect(parseCaseUpdate({ matterName: " ", status: "active", assignedUserId: "user-1" })).toEqual({
      ok: false,
      errors: { matterName: "Matter name is required." },
    });
  });

  it("normalizes person contact details and treats a blank timezone as inferred", () => {
    expect(
      parsePersonUpdate({
        name: "Jordan Lee",
        phone: "312-555-0101",
        email: "jordan@example.com",
        timeZone: "America/Chicago",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Jordan Lee",
        phone: "+13125550101",
        email: "jordan@example.com",
        timeZone: "America/Chicago",
        timeZoneSource: "explicit",
      },
    });

    expect(
      parsePersonUpdate({
        name: "Elena Park",
        phone: "",
        email: "",
        timeZone: "",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Elena Park",
        phone: null,
        email: null,
        timeZone: null,
        timeZoneSource: null,
      },
    });
  });

  it("rejects invalid person email and timezone without changing the rest of the payload", () => {
    expect(
      parsePersonUpdate({
        name: "Sam Rivera",
        phone: "",
        email: "not-an-email",
        timeZone: "Chicago",
      }),
    ).toEqual({
      ok: false,
      errors: {
        email: "Enter a valid email, or leave it blank.",
        timeZone: "Choose a valid IANA timezone.",
      },
    });
  });

  it("accepts organization contact fields used on a case", () => {
    expect(
      parseOrganizationUpdate({
        name: " Northside Imaging ",
        type: "medical_provider",
        phone: "312-555-0199",
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Northside Imaging",
        type: "medical_provider",
        phone: "+13125550199",
      },
    });
  });
});

describe("createCaseRecord workflow start", () => {
  const baseInput = {
    matterName: "Lee v. Metro Transit",
    status: "active" as const,
    assignedUserId: "firm-user-1",
    clientName: "Jordan Lee",
    clientPhone: "+13125550101",
    clientEmail: null,
    clientTimeZone: null,
    providerName: null,
    providerPhone: null,
    workflowDefinitionId: "client-check-in" as const,
  };

  it("starts the temporal workflow with the created run id", async () => {
    state.inserts = [];
    const startWorkflowRun = vi.fn(async () => "wf-run-id");

    const caseId = await createCaseRecord(baseInput, { startWorkflowRun });

    expect(caseId).toBe("generated-id");
    expect(startWorkflowRun).toHaveBeenCalledTimes(1);
    expect(startWorkflowRun).toHaveBeenCalledWith({ workflowRunId: "generated-id" });
    expect(state.inserts.map((insert) => insert.table)).toEqual([
      "people",
      "cases",
      "case_participants",
      "workflow_runs",
      "workflow_steps",
      "workflow_events",
    ]);
    expect(state.inserts.at(-1)?.values).toMatchObject({ type: "workflow.started" });
  });

  it("records a step.schedule_failed event instead of throwing when the workflow cannot start", async () => {
    state.inserts = [];
    const startWorkflowRun = vi.fn(async () => {
      throw new Error("temporal unavailable");
    });

    await expect(createCaseRecord(baseInput, { startWorkflowRun })).resolves.toBe("generated-id");

    expect(state.inserts.at(-1)).toEqual({
      table: "workflow_events",
      values: expect.objectContaining({
        type: "step.schedule_failed",
        summary: "Workflow execution could not be started; it will be recovered by the next signal or worker restart.",
        actorType: "system",
        payload: { error: "temporal unavailable" },
      }),
    });
  });
});
