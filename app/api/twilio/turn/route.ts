import { handleCallTurn } from "@/modules/phone/service";
import { DrizzlePhoneCallStore } from "@/modules/phone/store";
import { createCallLlmClient, loadPhoneRuntimeConfig, readTwilioForm, twilioWebhookUrl, validateTwilioSignature } from "@/modules/phone/config";

export async function POST(request: Request) {
  const config = loadPhoneRuntimeConfig();
  const params = await readTwilioForm(request);
  const url = twilioWebhookUrl(request, config.publicBaseUrl);
  if (!validateTwilioSignature({
    authToken: config.authToken,
    signature: request.headers.get("x-twilio-signature"),
    url,
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
  });
  return new Response(twiml, { headers: { "Content-Type": "text/xml" } });
}
