import type { ReactNode } from "react";
import Link from "next/link";
import React from "react";

export function humanize(value: string) {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function relativeTime(value: Date | string, now: Date = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = date.getTime() - now.getTime();
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const suffix = diffMs < 0 ? "ago" : "";
  const prefix = diffMs >= 0 ? "in " : "";
  if (absMinutes < 1) return diffMs < 0 ? "just now" : "now";
  if (absMinutes < 60) return `${prefix}${absMinutes}m ${suffix}`.trim();
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return `${prefix}${hours}h ${suffix}`.trim();
  const days = Math.round(hours / 24);
  return `${prefix}${days}d ${suffix}`.trim();
}

const badgeTones = {
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/20",
  accent: "bg-teal-50 text-teal-700 ring-teal-600/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/25",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

const statusTones: Record<string, BadgeTone> = {
  active: "accent",
  running: "info",
  due: "warning",
  pending: "neutral",
  waiting_for_human: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  skipped: "neutral",
  open: "warning",
  assigned: "info",
  approved: "success",
  edited: "info",
  resolved: "success",
  rejected: "danger",
  reached: "success",
  left_message: "info",
  refused: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
  on_hold: "warning",
  closed: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTones[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">{eyebrow}</p>
        ) : null}
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-white shadow-card", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  icon,
  description,
  action,
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon ? <span className="text-muted">{icon}</span> : null}
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action ? (
        <Link
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-teal-50"
          href={action.href}
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {icon ? <span className="text-line">{icon}</span> : null}
      <p className="max-w-sm text-sm text-muted">{children}</p>
    </div>
  );
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-panel hover:text-ink",
};

export const inputClass = (error?: string) =>
  cx(
    "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 transition-shadow focus:border-accent focus:outline-none focus:ring-2 focus:ring-teal-600/15",
    error ? "border-danger" : "border-line",
  );

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
      <label className="block text-xs font-medium uppercase tracking-wide text-muted" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}

export function SaveBar({ pending, saved, error }: { pending: boolean; saved: boolean; error?: string }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
      <p className="text-xs" aria-live="polite">
        {error ? (
          <span className="font-medium text-danger">{error}</span>
        ) : saved ? (
          <span className="font-medium text-success">Saved.</span>
        ) : (
          <span className="text-muted">Only this section is saved.</span>
        )}
      </p>
      <button className={btn.primary} disabled={pending} type="submit">
        {pending ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

export function Timeline({
  items,
}: {
  items: Array<{
    id: string;
    title: ReactNode;
    meta?: ReactNode;
    badge?: ReactNode;
    body?: ReactNode;
    dotTone?: BadgeTone;
  }>;
}) {
  const dotTones: Record<BadgeTone, string> = {
    neutral: "bg-slate-400",
    accent: "bg-teal-600",
    success: "bg-emerald-500",
    info: "bg-blue-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
  };
  return (
    <ol className="relative">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={cx("relative ml-3 pb-5 pl-6 last:pb-0", index > 0 && "pt-0")}
        >
          {index < items.length - 1 ? (
            <span aria-hidden className="absolute left-0 top-4 h-full w-px bg-line" />
          ) : null}
          <span
            aria-hidden
            className={cx(
              "absolute -left-[5.5px] top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-white",
              dotTones[item.dotTone ?? "neutral"],
            )}
          />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-ink">{item.title}</span>
            {item.badge}
          </div>
          {item.body ? <div className="mt-0.5 text-sm text-muted">{item.body}</div> : null}
          {item.meta ? <div className="mt-0.5 text-xs text-muted">{item.meta}</div> : null}
        </li>
      ))}
    </ol>
  );
}

export function Callout({
  tone = "accent",
  title,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  children: ReactNode;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "border-slate-300 bg-slate-50",
    accent: "border-teal-600 bg-teal-50/60",
    success: "border-emerald-500 bg-emerald-50/60",
    info: "border-blue-500 bg-blue-50/60",
    warning: "border-amber-500 bg-amber-50/60",
    danger: "border-red-500 bg-red-50/60",
  };
  return (
    <div className={cx("rounded-lg border-l-4 px-3 py-2 text-sm", tones[tone])}>
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      <div className="text-muted">{children}</div>
    </div>
  );
}

export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function Avatar({ name, tone = "accent" }: { name: string; tone?: BadgeTone }) {
  const backgrounds: Record<BadgeTone, string> = {
    neutral: "bg-slate-200 text-slate-700",
    accent: "bg-teal-100 text-teal-800",
    success: "bg-emerald-100 text-emerald-800",
    info: "bg-blue-100 text-blue-800",
    warning: "bg-amber-100 text-amber-800",
    danger: "bg-red-100 text-red-800",
  };
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold",
        backgrounds[tone],
      )}
    >
      {initialsOf(name) || "?"}
    </span>
  );
}
