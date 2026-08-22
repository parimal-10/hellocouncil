export const defaultSyntheticResponses: Record<string, string> = {
  provider_follow_up: "Provider says records are in process and should be ready Friday.",
  client_check_in: "Client reports recovery is improving and has no questions.",
};

export function getSyntheticResponse(stepType: string, overrides: Record<string, string> = {}) {
  return overrides[stepType] ?? defaultSyntheticResponses[stepType] ?? "No synthetic response configured.";
}
