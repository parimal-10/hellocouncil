import { handleCallTurn } from "@/modules/phone/service";
import { DrizzlePhoneCallStore } from "@/modules/phone/store";
import {
  authorizeTwilioWebhook,
  createCallLlmClient,
  loadPhoneRuntimeConfig,
  readTwilioForm,
  twilioWebhookUrlCandidates,
} from "@/modules/phone/config";

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

  const twiml = await handleCallTurn({
    callId,
    speech: params.SpeechResult,
    store: new DrizzlePhoneCallStore(),
    llm: createCallLlmClient(config.llm),
    now: new Date(),
    publicBaseUrl: config.publicBaseUrl,
  });
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
