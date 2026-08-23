import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createLiveKitAgent, runVoiceAgentCli } from "./agent";

export default createLiveKitAgent();

runVoiceAgentCli(fileURLToPath(import.meta.url));
