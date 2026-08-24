import type { ConnectionStatus } from "./types";

export function connectionStatusFromTwilio(input: {
  callStatus: string;
  answeredBy?: string | null;
  previous?: ConnectionStatus | null;
}): ConnectionStatus {
  if (isMachine(input.answeredBy)) return "voicemail";

  switch (input.callStatus) {
    case "queued":
    case "initiated":
      return input.previous ?? "initiated";
    case "ringing":
      return "ringing";
    case "in-progress":
      return "answered";
    case "busy":
      return "busy";
    case "no-answer":
      return "no-answer";
    case "failed":
    case "canceled":
      return "failed";
    case "completed":
      if (input.previous === "voicemail" || input.previous === "answered") return input.previous;
      if (input.answeredBy === "human") return "answered";
      return input.previous ?? "answered";
    default:
      return input.previous ?? "initiated";
  }
}

export function isMachine(answeredBy?: string | null): boolean {
  if (!answeredBy) return false;
  return answeredBy === "fax" || answeredBy.startsWith("machine");
}

export function contactOutcomeFor(status: ConnectionStatus): "reached" | "left_message" | "failed" | null {
  if (status === "answered") return "reached";
  if (status === "voicemail") return "left_message";
  if (status === "no-answer" || status === "busy" || status === "failed") return "failed";
  return null;
}

export function isTerminalConnectionStatus(status: ConnectionStatus): boolean {
  return status === "answered" || status === "voicemail" || status === "no-answer" || status === "busy" || status === "failed";
}
