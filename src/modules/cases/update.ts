import { toE164 } from "@/modules/phone/phone-number";
import { isValidIanaTimeZone } from "@/modules/time/timezone";

export const CASE_STATUSES = ["active", "on_hold", "closed"] as const;
export const ORGANIZATION_TYPES = ["medical_provider", "law_firm", "other"] as const;

export const PERSON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type CaseUpdate = {
  matterName: string;
  status: CaseStatus;
  assignedUserId: string;
};

export type PersonUpdate = {
  name: string;
  phone: string | null;
  email: string | null;
  timeZone: string | null;
  timeZoneSource: "explicit" | null;
};

export type OrganizationUpdate = {
  name: string;
  type: OrganizationType;
  phone: string | null;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export function parseCaseUpdate(input: {
  matterName: unknown;
  status: unknown;
  assignedUserId: unknown;
}): ParseResult<CaseUpdate> {
  const errors: Record<string, string> = {};
  const matterName = requiredText(input.matterName);
  if (!matterName) errors.matterName = "Matter name is required.";

  const status = String(input.status ?? "").trim();
  if (!CASE_STATUSES.includes(status as CaseStatus)) {
    errors.status = "Choose a valid case status.";
  }

  const assignedUserId = requiredText(input.assignedUserId);
  if (!assignedUserId) errors.assignedUserId = "An assigned firm user is required.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      matterName,
      status: status as CaseStatus,
      assignedUserId,
    },
  };
}

export function parsePersonUpdate(input: {
  name: unknown;
  phone: unknown;
  email: unknown;
  timeZone: unknown;
}): ParseResult<PersonUpdate> {
  const errors: Record<string, string> = {};
  const name = requiredText(input.name);
  if (!name) errors.name = "Name is required.";

  const phoneRaw = optionalText(input.phone);
  let phone: string | null = null;
  if (phoneRaw) {
    phone = toE164(phoneRaw) ?? phoneRaw;
  }

  const email = optionalText(input.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email, or leave it blank.";
  }

  const timeZoneRaw = optionalText(input.timeZone);
  let timeZone: string | null = null;
  let timeZoneSource: "explicit" | null = null;
  if (timeZoneRaw) {
    if (!isValidIanaTimeZone(timeZoneRaw)) {
      errors.timeZone = "Choose a valid IANA timezone.";
    } else {
      timeZone = timeZoneRaw;
      timeZoneSource = "explicit";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      phone,
      email,
      timeZone,
      timeZoneSource,
    },
  };
}

export function parseOrganizationUpdate(input: {
  name: unknown;
  type: unknown;
  phone: unknown;
}): ParseResult<OrganizationUpdate> {
  const errors: Record<string, string> = {};
  const name = requiredText(input.name);
  if (!name) errors.name = "Organization name is required.";

  const type = String(input.type ?? "").trim();
  if (!ORGANIZATION_TYPES.includes(type as OrganizationType)) {
    errors.type = "Choose a valid organization type.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const phoneRaw = optionalText(input.phone);
  return {
    ok: true,
    value: {
      name,
      type: type as OrganizationType,
      phone: phoneRaw ? toE164(phoneRaw) ?? phoneRaw : null,
    },
  };
}

function requiredText(value: unknown) {
  const text = optionalText(value);
  return text ?? "";
}

function optionalText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
