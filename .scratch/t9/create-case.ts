import "dotenv/config";
import { pool } from "@/db/client";
import { createCaseRecord, listFirmUsers } from "@/modules/cases/store";

const users = await listFirmUsers();
if (!users[0]) throw new Error("No firm user available");
const caseId = await createCaseRecord({
  matterName: "T9 E2E Verification",
  status: "active",
  assignedUserId: users[0].id,
  clientName: "T9 Test Client",
  clientPhone: "+15005550006",
  clientEmail: null,
  clientTimeZone: "America/New_York",
  providerName: null,
  providerPhone: null,
  workflowDefinitionId: "client-check-in",
});
console.log(JSON.stringify({ caseId }));
await pool.end();
