import { describe, expect, it } from "vitest";
import { buildWorkflowBriefing } from "@/modules/workflows/briefing";
import { getWorkflowDefinition } from "@/modules/workflows/definitions";

const now = new Date("2026-08-24T12:00:00.000Z");

describe("workflow briefing", () => {
  it("summarizes a blocked medical-records case and withholds immediate follow-up", () => {
    const briefing = buildWorkflowBriefing({
      run: {
        status: "waiting_for_human",
        title: "Northside Imaging records follow-up",
        summary: "Provider refused release until authorization is verified.",
        definitionId: "medical-records-follow-up",
      },
      definition: getWorkflowDefinition("medical-records-follow-up"),
      context: {
        matterName: "Lee v. Metro Transit",
        clientName: "Jordan Lee",
        providerName: "Northside Imaging",
        assignedUserName: "Maya Singh",
      },
      steps: [
        {
          id: "step-1",
          label: "Follow up with provider",
          status: "waiting_for_human",
          dueAt: new Date("2026-08-24T10:00:00.000Z"),
          stepType: "provider_follow_up",
        },
      ],
      reviews: [
        {
          id: "review-1",
          status: "open",
          reason: "provider_refusal",
          summary: "Provider said they cannot release records without a verified authorization.",
        },
      ],
      attempts: [{ channel: "phone", outcome: "refused", summary: "Provider refused to release records." }],
      events: [
        {
          type: "workflow.started",
          summary: "Medical records follow-up started.",
          occurredAt: new Date("2026-08-20T12:00:00.000Z"),
        },
        {
          type: "review.created",
          summary: "Human review created for provider refusal.",
          occurredAt: new Date("2026-08-24T10:00:00.000Z"),
        },
      ],
      now,
    });

    expect(briefing.canRunFollowUpNow).toBe(false);
    expect(briefing.nextFollowUp).toBeNull();
    expect(briefing.currentStatus).toContain("waiting for human review");
    expect(briefing.nextSteps[0]).toContain("Human review must be resolved");
    expect(briefing.agentContext).toContain("review-1");
    expect(briefing.validStepTypes).toEqual(["provider_follow_up"]);
  });

  it("includes the next scheduled follow-up for an active run", () => {
    const dueAt = new Date("2026-08-25T06:00:00.000Z");
    const briefing = buildWorkflowBriefing({
      run: {
        status: "active",
        title: "Harbor Orthopedics records follow-up",
        summary: "Harbor confirmed the request is in queue.",
        definitionId: "medical-records-follow-up",
      },
      definition: getWorkflowDefinition("medical-records-follow-up"),
      context: {
        matterName: "Shah v. Lakeside Motors",
        clientName: "Priya Shah",
        providerName: "Harbor Orthopedics",
        assignedUserName: "Maya Singh",
        timeZone: "America/New_York",
      },
      steps: [
        {
          id: "step-1",
          label: "Follow up with provider",
          status: "completed",
          dueAt: new Date("2026-08-23T12:00:00.000Z"),
          stepType: "provider_follow_up",
        },
        {
          id: "step-2",
          label: "Follow up with provider",
          status: "due",
          dueAt,
          stepType: "provider_follow_up",
        },
      ],
      reviews: [],
      attempts: [],
      events: [
        {
          type: "step.completed",
          summary: "Harbor confirmed the request is in queue.",
          occurredAt: new Date("2026-08-23T12:00:00.000Z"),
        },
        {
          type: "step.scheduled",
          summary: "Follow up with provider scheduled.",
          occurredAt: new Date("2026-08-23T12:00:00.000Z"),
        },
      ],
      now,
    });

    expect(briefing.canRunFollowUpNow).toBe(true);
    expect(briefing.nextFollowUp).toEqual({
      label: "Follow up with provider",
      dueAt,
      status: "due",
    });
    expect(briefing.spokenSummary).toContain("Tuesday, August 25, 2026");
    expect(briefing.spokenSummary).not.toContain(dueAt.toISOString());
    expect(briefing.nextSteps[0]).toContain("scheduled for");
    expect(briefing.nextSteps[0]).not.toContain(dueAt.toISOString());
  });
});
