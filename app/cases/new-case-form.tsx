"use client";

import { useActionState } from "react";
import { Briefcase } from "lucide-react";
import { createCaseAction } from "../actions/cases";
import { CASE_STATUSES, PERSON_TIME_ZONES, WORKFLOW_DEFINITION_OPTIONS } from "@/modules/cases/update";
import { Field, btn, cx, humanize, inputClass } from "./ui";

type FirmUser = { id: string; name: string };

export function NewCaseForm({ firmUsers }: { firmUsers: FirmUser[] }) {
  const [state, action, pending] = useActionState(createCaseAction, null);
  const errors = state && !state.ok ? state.errors : {};

  return (
    <form
      action={action}
      className="overflow-hidden rounded-xl border border-line bg-white shadow-card"
    >
      <div className="border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Briefcase aria-hidden size={15} className="text-muted" />
          New case
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          Create the matter, add the client and provider contacts, and optionally start a long-running workflow immediately.
        </p>
      </div>

      <div className="space-y-6 px-5 py-5">
        <Section title="Matter">
          <div className="grid gap-4 md:grid-cols-3">
            <Field error={errors.matterName} id="new-matterName" label="Matter name">
              <input
                className={inputClass(errors.matterName)}
                defaultValue=""
                id="new-matterName"
                name="matterName"
                placeholder="Doe v. Acme Trucking"
              />
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
              <select
                className={inputClass(errors.assignedUserId)}
                defaultValue={firmUsers[0]?.id ?? ""}
                id="new-assignedUserId"
                name="assignedUserId"
              >
                {firmUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Client">
          <div className="grid gap-4 md:grid-cols-4">
            <Field error={errors.clientName} id="new-clientName" label="Client name">
              <input className={inputClass(errors.clientName)} id="new-clientName" name="clientName" />
            </Field>
            <Field error={errors.clientPhone} hint="Used for outbound calling." id="new-clientPhone" label="Phone">
              <input
                className={inputClass(errors.clientPhone)}
                id="new-clientPhone"
                name="clientPhone"
                placeholder="+1..."
              />
            </Field>
            <Field error={errors.clientEmail} id="new-clientEmail" label="Email">
              <input className={inputClass(errors.clientEmail)} id="new-clientEmail" name="clientEmail" type="email" />
            </Field>
            <Field
              error={errors.clientTimeZone}
              hint="Blank infers from area code."
              id="new-clientTimeZone"
              label="Timezone"
            >
              <select
                className={inputClass(errors.clientTimeZone)}
                defaultValue=""
                id="new-clientTimeZone"
                name="clientTimeZone"
              >
                <option value="">Infer automatically</option>
                {PERSON_TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Medical provider" hint="Optional — needed for records follow-up calls.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field error={errors.providerName} id="new-providerName" label="Provider name">
              <input className={inputClass(errors.providerName)} id="new-providerName" name="providerName" />
            </Field>
            <Field error={errors.providerPhone} hint="Used for outbound calling." id="new-providerPhone" label="Phone">
              <input
                className={inputClass(errors.providerPhone)}
                id="new-providerPhone"
                name="providerPhone"
                placeholder="+1..."
              />
            </Field>
          </div>
        </Section>

        <Section title="Workflow" hint="The first follow-up is scheduled now; the worker places the call autonomously when it is due.">
          <div className="max-w-md">
            <Field
              error={errors.workflowDefinitionId}
              id="new-workflowDefinitionId"
              label="Start a workflow run"
            >
              <select
                className={inputClass(errors.workflowDefinitionId)}
                defaultValue="none"
                id="new-workflowDefinitionId"
                name="workflowDefinitionId"
              >
                <option value="none">Do not start a workflow yet</option>
                {WORKFLOW_DEFINITION_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/60 px-5 py-4">
        <p className="text-xs" aria-live="polite">
          {errors.form ? (
            <span className="font-medium text-danger">{errors.form}</span>
          ) : (
            <span className="text-muted">The workflow starts as soon as the case is saved.</span>
          )}
        </p>
        <button className={btn.primary} disabled={pending} type="submit">
          {pending ? "Creating..." : "Create case"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className={cx("min-w-0")}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        {title}
        {hint ? <span className="ml-2 font-normal normal-case tracking-normal">· {hint}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}
