import { createTwilioVoiceClient, loadPhoneRuntimeConfig } from "./config";
import type { OutboundFollowUpPort } from "./orchestration";
import { placeOutboundCall } from "./service";
import { DrizzlePhoneCallStore, loadOutboundCallContext } from "./store";

export function createWorkerOutboundDialer(): OutboundFollowUpPort {
  loadPhoneRuntimeConfig();
  return {
    async evaluateWindow({ workflowRunId }) {
      const context = await loadOutboundCallContext(workflowRunId);
      return { timeZone: context.timeZone };
    },
    async placeCall({ workflowRunId, stepId, now }) {
      const config = loadPhoneRuntimeConfig();
      const context = await loadOutboundCallContext(workflowRunId);
      const result = await placeOutboundCall({
        context,
        now,
        store: new DrizzlePhoneCallStore(),
        twilio: createTwilioVoiceClient(config),
        config,
        workflowStepId: stepId,
      });
      return { callId: result.call.id };
    },
  };
}
