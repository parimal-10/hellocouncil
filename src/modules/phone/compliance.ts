import { DateTime } from "luxon";
import { formatInTimeZone, isValidIanaTimeZone } from "@/modules/time/timezone";
import type { ComplianceFlag, ComplianceResult } from "./types";

const QUIET_HOUR_START = 8;
const QUIET_HOUR_END = 21;

export function evaluateOutboundCallCompliance(input: {
  timeZone: string;
  now: Date;
  consentRecorded: boolean;
  onDoNotCallList: boolean;
}): ComplianceResult {
  const flags: ComplianceFlag[] = [
    {
      code: "disclosure_required",
      detail: "Automated outbound calls generally require identity/purpose disclosure and, for marketing or certain recorded calls, prior express consent. Confirm with counsel before production use.",
    },
  ];

  if (isValidIanaTimeZone(input.timeZone)) {
    const local = DateTime.fromJSDate(input.now, { zone: "utc" }).setZone(input.timeZone);
    if (local.hour < QUIET_HOUR_START || local.hour >= QUIET_HOUR_END) {
      flags.push({
        code: "quiet_hours",
        detail: `Call would be placed at ${formatInTimeZone(input.now, input.timeZone)}, outside typical permitted calling hours (8:00 AM–9:00 PM local). This is flagged, not blocked, for the manual test path.`,
      });
    }
  }

  if (!input.consentRecorded) {
    flags.push({
      code: "consent_unconfirmed",
      detail: "No consent record is stored on this case. TCPA and state mini-TCPA rules may require prior express consent before an automated call. Confirm before relying on this path.",
    });
  }

  if (input.onDoNotCallList) {
    flags.push({
      code: "do_not_call",
      detail: "This number is marked do-not-call in the local flag passed to the caller. Do-not-call handling is not auto-enforced yet.",
    });
  }

  return { blocked: false, flags };
}
