"use client";

import { useActionState } from "react";
import { updateCaseAction, updateOrganizationAction, updatePersonAction } from "../../actions/cases";
import { CASE_STATUSES, ORGANIZATION_TYPES, PERSON_TIME_ZONES } from "@/modules/cases/update";
import { inferTimeZoneFromPhone, resolvePersonTimeZone } from "@/modules/time/timezone";
import { Field, SaveBar, humanize, inputClass } from "../ui";

type FirmUser = { id: string; name: string };

export function MatterForm({
  caseId,
  matterName,
  status,
  assignedUserId,
  firmUsers,
}: {
  caseId: string;
  matterName: string;
  status: string;
  assignedUserId: string;
  firmUsers: FirmUser[];
}) {
  const [state, action, pending] = useActionState(updateCaseAction, null);
  const errors = state && !state.ok ? state.errors : {};
  const statuses = CASE_STATUSES.includes(status as (typeof CASE_STATUSES)[number])
    ? CASE_STATUSES
    : [status, ...CASE_STATUSES];

  return (
    <form action={action}>
      <input name="caseId" type="hidden" value={caseId} />
      <div className="grid gap-3 md:grid-cols-2">
        <Field error={errors.matterName} id="matterName" label="Matter name">
          <input className={inputClass(errors.matterName)} defaultValue={matterName} id="matterName" name="matterName" />
        </Field>
        <Field error={errors.status} id="status" label="Status">
          <select className={inputClass(errors.status)} defaultValue={status} id="status" name="status">
            {statuses.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field error={errors.assignedUserId} id="assignedUserId" label="Assigned firm user">
          <select
            className={inputClass(errors.assignedUserId)}
            defaultValue={assignedUserId}
            id="assignedUserId"
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
      <SaveBar error={errors.form} pending={pending} saved={state?.ok === true} />
    </form>
  );
}

export function PersonForm({
  caseId,
  person,
}: {
  caseId: string;
  person: {
    id: string;
    name: string;
    role: string;
    participantRole: string;
    phone: string | null;
    email: string | null;
    timeZone: string | null;
    timeZoneSource: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updatePersonAction, null);
  const errors = state && !state.ok ? state.errors : {};
  const zones = person.timeZone && !PERSON_TIME_ZONES.includes(person.timeZone as (typeof PERSON_TIME_ZONES)[number])
    ? [person.timeZone, ...PERSON_TIME_ZONES]
    : [...PERSON_TIME_ZONES];
  const resolved = resolvePersonTimeZone({
    explicitTimeZone: person.timeZone,
    phone: person.phone,
  });
  const inferred = person.phone ? inferTimeZoneFromPhone(person.phone) : null;

  return (
    <form action={action}>
      <input name="caseId" type="hidden" value={caseId} />
      <input name="personId" type="hidden" value={person.id} />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded border border-line px-2 py-1">{humanize(person.participantRole)}</span>
        <span className="rounded border border-line px-2 py-1">{humanize(person.role)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field error={errors.name} id={`name-${person.id}`} label="Name">
          <input className={inputClass(errors.name)} defaultValue={person.name} id={`name-${person.id}`} name="name" />
        </Field>
        <Field error={errors.phone} hint="Used for outbound calling." id={`phone-${person.id}`} label="Phone">
          <input
            className={inputClass(errors.phone)}
            defaultValue={person.phone ?? ""}
            id={`phone-${person.id}`}
            name="phone"
            placeholder="+1..."
          />
        </Field>
        <Field error={errors.email} id={`email-${person.id}`} label="Email">
          <input
            className={inputClass(errors.email)}
            defaultValue={person.email ?? ""}
            id={`email-${person.id}`}
            name="email"
            type="email"
          />
        </Field>
        <Field
          error={errors.timeZone}
          hint={
            inferred
              ? `Phone area code suggests ${inferred.timeZone}. Leave blank to use that instead of an explicit zone.`
              : "Leave blank to infer from phone, then fall back to America/New_York."
          }
          id={`timeZone-${person.id}`}
          label="Timezone"
        >
          <select
            className={inputClass(errors.timeZone)}
            defaultValue={person.timeZone ?? ""}
            id={`timeZone-${person.id}`}
            name="timeZone"
          >
            <option value="">Infer automatically</option>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted">
        Calls currently use {resolved.timeZone} ({humanize(resolved.source)}
        {person.timeZoneSource ? `, stored as ${humanize(person.timeZoneSource)}` : ""}).
      </p>
      <SaveBar error={errors.form} pending={pending} saved={state?.ok === true} />
    </form>
  );
}

export function OrganizationForm({
  caseId,
  organization,
}: {
  caseId: string;
  organization: {
    id: string;
    name: string;
    type: string;
    participantRole: string;
    phone: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateOrganizationAction, null);
  const errors = state && !state.ok ? state.errors : {};
  const types = ORGANIZATION_TYPES.includes(organization.type as (typeof ORGANIZATION_TYPES)[number])
    ? ORGANIZATION_TYPES
    : [organization.type, ...ORGANIZATION_TYPES];

  return (
    <form action={action}>
      <input name="caseId" type="hidden" value={caseId} />
      <input name="organizationId" type="hidden" value={organization.id} />
      <div className="mb-3 text-xs text-muted">
        <span className="rounded border border-line px-2 py-1">{humanize(organization.participantRole)}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field error={errors.name} id={`org-name-${organization.id}`} label="Name">
          <input
            className={inputClass(errors.name)}
            defaultValue={organization.name}
            id={`org-name-${organization.id}`}
            name="name"
          />
        </Field>
        <Field error={errors.type} id={`org-type-${organization.id}`} label="Type">
          <select
            className={inputClass(errors.type)}
            defaultValue={organization.type}
            id={`org-type-${organization.id}`}
            name="type"
          >
            {types.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field error={errors.phone} id={`org-phone-${organization.id}`} label="Phone">
          <input
            className={inputClass(errors.phone)}
            defaultValue={organization.phone ?? ""}
            id={`org-phone-${organization.id}`}
            name="phone"
          />
        </Field>
      </div>
      <SaveBar error={errors.form} pending={pending} saved={state?.ok === true} />
    </form>
  );
}
