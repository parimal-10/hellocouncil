import { resolveClientTimeExpression } from "@/modules/time/timezone";
import type { LlmClient } from "./llm";
import type { PhoneCallRecord, StructuredCallOutcome } from "./types";

export async function extractCallOutcome(input: {
  call: PhoneCallRecord;
  llm: LlmClient;
  now: Date;
}): Promise<StructuredCallOutcome> {
  const transcript = input.call.transcript
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join("\n");
  const raw = await input.llm.complete([
    {
      role: "system",
      content: [
        "Extract structured outcomes from this outbound legal-intake phone call.",
        "Return JSON only with keys: newInformation (string[]), requestedCallback (string|null), status (string), sentiment (positive|neutral|negative|unknown), shouldContinueOutreach (boolean), recommendedFollowUpHours (number|null), urgency (high|normal|low).",
        "requestedCallback must be the client's own local wording (for example 'Tuesday at 3pm' or 'in 1 min'), never a UTC timestamp.",
        "recommendedFollowUpHours is how many hours until the next check-in if the client did not name a specific time. Use a smaller number when the case is urgent.",
      ].join(" "),
    },
    { role: "user", content: transcript || "No transcript was captured." },
  ]);

  const parsed = parseOutcomeJson(raw);
  const callback = parsed.requestedCallback
    ? resolveClientTimeExpression(parsed.requestedCallback, input.call.timeZone, input.now)
    : null;

  return {
    newInformation: parsed.newInformation,
    requestedCallbackAt: callback?.ok ? callback.utc.toISOString() : null,
    requestedCallbackLocal: callback?.ok ? callback.localLabel : null,
    status: parsed.status,
    sentiment: parsed.sentiment,
    shouldContinueOutreach: parsed.shouldContinueOutreach,
    recommendedFollowUpHours: parsed.recommendedFollowUpHours,
    urgency: parsed.urgency,
  };
}

function parseOutcomeJson(raw: string): {
  newInformation: string[];
  requestedCallback: string | null;
  status: string;
  sentiment: StructuredCallOutcome["sentiment"];
  shouldContinueOutreach: boolean;
  recommendedFollowUpHours: number | null;
  urgency: StructuredCallOutcome["urgency"];
} {
  const jsonText = raw.trim().replace(/^```json\s*|\s*```$/g, "");
  const parsed = JSON.parse(jsonText) as {
    newInformation?: unknown;
    requestedCallback?: unknown;
    status?: unknown;
    sentiment?: unknown;
    shouldContinueOutreach?: unknown;
    recommendedFollowUpHours?: unknown;
    urgency?: unknown;
  };
  const sentiment =
    parsed.sentiment === "positive" || parsed.sentiment === "neutral" || parsed.sentiment === "negative"
      ? parsed.sentiment
      : "unknown";
  const urgency = parsed.urgency === "high" || parsed.urgency === "low" ? parsed.urgency : "normal";
  const recommended =
    typeof parsed.recommendedFollowUpHours === "number" && Number.isFinite(parsed.recommendedFollowUpHours)
      ? parsed.recommendedFollowUpHours
      : null;
  return {
    newInformation: Array.isArray(parsed.newInformation)
      ? parsed.newInformation.filter((item): item is string => typeof item === "string")
      : [],
    requestedCallback: typeof parsed.requestedCallback === "string" && parsed.requestedCallback.trim()
      ? parsed.requestedCallback.trim()
      : null,
    status: typeof parsed.status === "string" && parsed.status.trim() ? parsed.status.trim() : "unknown",
    sentiment,
    shouldContinueOutreach: parsed.shouldContinueOutreach !== false,
    recommendedFollowUpHours: recommended,
    urgency,
  };
}
