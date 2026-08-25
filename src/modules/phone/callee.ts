import type { OutboundCallContext } from "./types";

export type CalleeRole = "client" | "provider";

export type OutboundCallee = {
  role: CalleeRole;
  name: string;
  phone: string;
};

export function resolveOutboundCallee(
  context: Pick<OutboundCallContext, "clientName" | "clientPhone" | "providerName" | "providerPhone" | "definitionId">,
  stepType?: string | null,
): OutboundCallee {
  if (calleeRoleFor(stepType, context.definitionId) === "provider") {
    return {
      role: "provider",
      name: context.providerName?.trim() || "the medical provider",
      phone: context.providerPhone ?? "",
    };
  }
  return {
    role: "client",
    name: context.clientName,
    phone: context.clientPhone,
  };
}

function calleeRoleFor(stepType?: string | null, definitionId?: string): CalleeRole {
  if (stepType === "provider_follow_up") return "provider";
  if (stepType === "client_check_in") return "client";
  if (definitionId === "medical-records-follow-up") return "provider";
  return "client";
}
