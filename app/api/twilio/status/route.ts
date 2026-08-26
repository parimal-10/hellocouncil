import { handleCallStatus } from "@/modules/phone/service";
import { DrizzlePhoneCallStore } from "@/modules/phone/store";
import { isTerminalConnectionStatus } from "@/modules/phone/status";
import { authorizeTwilioWebhook, createCallLlmClient, loadPhoneRuntimeConfig, readTwilioForm, twilioWebhookUrlCandidates } from "@/modules/phone/config";

export async function POST(request: Request) {
  const config = loadPhoneRuntimeConfig();
  const params = await readTwilioForm(request);
  const urls = twilioWebhookUrlCandidates(request, config.publicBaseUrl);
  if (!authorizeTwilioWebhook({
    authToken: config.authToken,
    apiSecret: config.apiSecret,
    accountSid: config.accountSid,
    signature: request.headers.get("x-twilio-signature"),
    userAgent: request.headers.get("user-agent"),
    urls,
    params,
  })) {
    return new Response("Forbidden", { status: 403 });
  }

  const callId = new URL(request.url).searchParams.get("callId");
  if (!callId) return new Response("Missing callId", { status: 400 });

  const phoneStore = new DrizzlePhoneCallStore();
  const now = new Date();
  const call = await handleCallStatus({
    callId,
    callStatus: params.CallStatus ?? "",
    answeredBy: params.AnsweredBy,
    store: phoneStore,
    llm: createCallLlmClient(config.llm),
    now,
  });

  if (isTerminalConnectionStatus(call.connectionStatus)) {
    const { signalRun } = await import("@/temporal/start-run");
    await signalRun({
      workflowRunId: call.workflowRunId,
      signal: "callCompleted",
      args: [{ callId: call.id }],
    });
  }

  return new Response(null, { status: 204 });
}
