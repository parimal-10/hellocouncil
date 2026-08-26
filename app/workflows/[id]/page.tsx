import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LiveKitVoiceLauncher } from "../../voice/livekit-room";
import {
  WorkflowDetailSections,
  loadWorkflowDetailSectionData,
} from "./workflow-detail-sections";
import { PageHeader, StatusBadge } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadWorkflowDetailSectionData(id);
  if (!data) notFound();
  const { detail, definition, briefing, callContext, phoneCalls } = data;

  return (
    <div className="space-y-6">
      <Link
        className="inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-accent"
        href={detail.caseRecord ? `/cases/${detail.caseRecord.id}` : "/cases"}
      >
        <ArrowLeft aria-hidden size={15} /> {detail.caseRecord ? "Back to case file" : "All cases"}
      </Link>

      <PageHeader
        eyebrow={definition.label}
        title={detail.context?.matterName ?? detail.run.title}
        description={
          detail.context
            ? `Client: ${detail.context.clientName}${detail.context.providerName ? ` - Provider: ${detail.context.providerName}` : ""} - Owner: ${detail.context.assignedUserName}`
            : detail.caseRecord?.matterName ?? undefined
        }
        actions={<StatusBadge status={detail.run.status} />}
      />

      <WorkflowDetailSections
        briefing={briefing}
        callContext={callContext}
        detail={detail}
        phoneCalls={phoneCalls}
        afterOutbound={
          <LiveKitVoiceLauncher
            runs={[{ id: detail.run.id, title: detail.run.title, summary: briefing.currentStatus }]}
            heading={briefing.canRunFollowUpNow ? "Do this follow-up now" : "Talk to the voice agent"}
            description={
              briefing.canRunFollowUpNow
                ? "Start a LiveKit session and tell the agent to run the follow-up now, or ask for the current case status."
                : "Start a LiveKit session to hear the current status. Outreach is paused until human review is resolved."
            }
            buttonLabel={briefing.canRunFollowUpNow ? "Do follow-up now with LiveKit" : "Ask the voice agent"}
          />
        }
      />
    </div>
  );
}
