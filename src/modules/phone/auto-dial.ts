export function isAutomaticOutboundCallingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AUTO_OUTBOUND_CALLS !== "true") return false;
  const nodeEnv = env.NODE_ENV ?? "development";
  return nodeEnv === "development" || nodeEnv === "test";
}
