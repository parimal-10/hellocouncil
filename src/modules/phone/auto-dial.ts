export function isAutomaticOutboundCallingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTO_OUTBOUND_CALLS === "true";
}
