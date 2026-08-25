"use server";

import { revalidatePath } from "next/cache";
import { updateCaseRecord, updateOrganizationRecord, updatePersonRecord } from "@/modules/cases/store";
import { parseCaseUpdate, parseOrganizationUpdate, parsePersonUpdate } from "@/modules/cases/update";

export type CaseActionState = { ok: true } | { ok: false; errors: Record<string, string> } | null;

export async function updateCaseAction(_prev: CaseActionState, formData: FormData): Promise<CaseActionState> {
  const caseId = requiredId(formData, "caseId");
  if (!caseId) return { ok: false, errors: { form: "Case is required." } };
  const parsed = parseCaseUpdate({
    matterName: formData.get("matterName"),
    status: formData.get("status"),
    assignedUserId: formData.get("assignedUserId"),
  });
  if (!parsed.ok) return parsed;
  try {
    await updateCaseRecord(caseId, parsed.value);
  } catch (error) {
    return { ok: false, errors: { form: error instanceof Error ? error.message : "Could not save the case." } };
  }
  revalidateCasePaths(caseId);
  return { ok: true };
}

export async function updatePersonAction(_prev: CaseActionState, formData: FormData): Promise<CaseActionState> {
  const caseId = requiredId(formData, "caseId");
  const personId = requiredId(formData, "personId");
  if (!caseId || !personId) return { ok: false, errors: { form: "Person is required." } };
  const parsed = parsePersonUpdate({
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.ok) return parsed;
  try {
    await updatePersonRecord(personId, parsed.value);
  } catch (error) {
    return { ok: false, errors: { form: error instanceof Error ? error.message : "Could not save this person." } };
  }
  revalidateCasePaths(caseId);
  return { ok: true };
}

export async function updateOrganizationAction(_prev: CaseActionState, formData: FormData): Promise<CaseActionState> {
  const caseId = requiredId(formData, "caseId");
  const organizationId = requiredId(formData, "organizationId");
  if (!caseId || !organizationId) return { ok: false, errors: { form: "Organization is required." } };
  const parsed = parseOrganizationUpdate({
    name: formData.get("name"),
    type: formData.get("type"),
    phone: formData.get("phone"),
  });
  if (!parsed.ok) return parsed;
  try {
    await updateOrganizationRecord(organizationId, parsed.value);
  } catch (error) {
    return { ok: false, errors: { form: error instanceof Error ? error.message : "Could not save this organization." } };
  }
  revalidateCasePaths(caseId);
  return { ok: true };
}

function requiredId(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function revalidateCasePaths(caseId: string) {
  revalidatePath("/");
  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/review");
  revalidatePath("/workflows/[id]", "page");
}
