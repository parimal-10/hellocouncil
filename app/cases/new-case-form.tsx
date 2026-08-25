"use client";

import { useActionState } from "react";
import { createCaseAction } from "../actions/cases";
import { CASE_STATUSES, PERSON_TIME_ZONES, WORKFLOW_DEFINITION_OPTIONS } from "@/modules/cases/update";
import { Field, humanize, inputClass } from "./ui";

type FirmUser = { id: string; name: string };

export function NewCaseForm({ firmUsers }: { firmUsers: FirmUser[] }) {
  const [state, action, pending] = useActionState(createCaseAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form action={action} className="rounded border border-line bg-white p-4">
      <h2 className="font-semibold">New case</h2>
      <p className="mt-1 text-sm text-muted">
        Create the matter, add the client and provider contacts, and optionally start a long-running workflow immediately.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field error={errors.matterName} id="new-matterName" label="Matter name">
          <input className={inputClass(errors.matterName)} defaultValue="" id="new-matterName" name="matterName" placeholder="Doe v. Acme Trucking" />
        </Field>
        <Field error={errors.status} id="new-status" label="Status">
          <select className={inputClass(errors.status)} defaultValue="active" id="new-status" name="status">
            {CASE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field error={errors.assignedUserId} id="new-assignedUserId" label="Assigned firm user">
          <select className={inputClass(errors.assignedUserId)} defaultValue={firmUsers[0]?.id ?? ""} id="new-assignedUserId" name="assignedUserId">
            {firmUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Client</h3>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field error={errors.clientName} id="new-clientName" label="Client name">
          <input className={inputClass(errors.clientName)} id="new-clientName" name="clientName" />
        </Field>
        <Field error={errors.clientPhone} hint="Used for outbound calling." id="new-clientPhone" label="Phone">
          <input className={inputClass(errors.clientPhone)} id="new-clientPhone" name="clientPhone" placeholder="+1..." />
        </Field>
        <Field error={errors.clientEmail} id="new-clientEmail" label="Email">
          <input className={inputClass(errors.clientEmail)} id="new-clientEmail" name="clientEmail" type="email" />
        </Field>
        <Field
          error={errors.clientTimeZone}
          hint="Leave blank to infer from the phone area code."
          id="new-clientTimeZone"
          label="Timezone"
        >
          <select className={inputClass(errors.clientTimeZone)} defaultValue="" id="new-clientTimeZone" name="clientTimeZone">
            <option value="">Infer automatically</option>
            {PERSON_TIME_ZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Medical provider (optional)</h3>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field error={errors.providerName} id="new-providerName" label="Provider name">
          <input className={inputClass(errors.providerName)} id="new-providerName" name="providerName" />
        </Field>
        <Field error={errors.providerPhone} hint="Used for outbound calling." id="new-providerPhone" label="Phone">
          <input className={inputClass(errors.providerPhone)} id="new-providerPhone" name="providerPhone" placeholder="+1..." />
        </Field>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Workflow</h3>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Field
          error={errors.workflowDefinitionId}
          hint="The first follow-up step is scheduled now; the worker places the outbound call autonomously when it is due."
          id="new-workflowDefinitionId"
          label="Start a workflow run"
        >
          <select className={inputClass(errors.workflowDefinitionId)} defaultValue="none" id="new-workflowDefinitionId" name="workflowDefinitionId">
            <option value="none">Do not start a workflow yet</option>
            {WORKFLOW_DEFINITION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted" aria-live="polite">
          {errors.form ? <span className="text-danger">{errors.form}</span> : "The workflow starts as soon as the case is saved."}
        </p>
        <button
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Creating..." : "Create case"}
        </button>
      </div>
    </form>
  );
}
