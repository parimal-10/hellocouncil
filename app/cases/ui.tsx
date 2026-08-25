import type { ReactNode } from "react";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function inputClass(error?: string) {
  return `mt-1 w-full rounded border bg-white p-2 text-sm ${error ? "border-danger" : "border-line"}`;
}

export function SaveBar({ pending, saved, error }: { pending: boolean; saved: boolean; error?: string }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <p className="text-xs text-muted" aria-live="polite">
        {error ? <span className="text-danger">{error}</span> : saved ? "Saved." : "Only this section is saved."}
      </p>
      <button
        className="rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-accent/30 bg-accent/10 text-accent"
      : status === "closed"
        ? "border-line bg-panel text-muted"
        : "border-warning/30 bg-warning/10 text-warning";
  return <span className={`shrink-0 rounded border px-2 py-1 text-xs ${tone}`}>{humanize(status)}</span>;
}

export function humanize(value: string) {
  return value.replaceAll("_", " ");
}
