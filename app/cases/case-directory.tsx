"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Phone, Search, Users } from "lucide-react";
import { Avatar, Card, EmptyState, StatusBadge, cx, humanize } from "../components/ui";

export type CaseDirectoryItem = {
  id: string;
  matterName: string;
  status: string;
  createdAt: string;
  assignedUserName: string;
  client: {
    name: string;
    phone: string | null;
    timeZone: string | null;
  } | null;
  provider: { name: string; phone: string | null } | null;
  workflowCount: number;
};

export function CaseDirectory({ cases }: { cases: CaseDirectoryItem[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const statuses = useMemo(() => ["all", ...[...new Set(cases.map((item) => item.status))].sort()], [cases]);
  const filtered = cases.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    const haystack = [
      item.matterName,
      item.assignedUserName,
      item.client?.name,
      item.client?.phone,
      item.provider?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full max-w-md">
          <span className="sr-only">Search cases</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search matter, client, provider, or phone"
            value={query}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {statuses.map((value) => (
            <button
              className={cx(
                "rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors",
                status === value
                  ? "bg-accent text-white ring-teal-700"
                  : "bg-white text-muted ring-line hover:bg-panel hover:text-ink",
              )}
              key={value}
              onClick={() => setStatus(value)}
              type="button"
            >
              {value === "all" ? "All" : humanize(value)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Users size={28} />}>
            {cases.length === 0 ? "No cases yet. Create your first case above." : "No cases match that search."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted">
            Showing {filtered.length} of {cases.length} {cases.length === 1 ? "case" : "cases"}
          </p>
          <ul className="space-y-2.5">
            {filtered.map((item) => (
              <li key={item.id}>
                <Link
                  className="group flex items-center gap-4 rounded-xl border border-line bg-white p-4 shadow-card transition-shadow hover:shadow-pop"
                  href={`/cases/${item.id}`}
                >
                  <Avatar name={item.matterName} tone={item.status === "active" ? "accent" : "neutral"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-semibold text-ink">{item.matterName}</p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted">
                      {[
                        item.client ? item.client.name : "No client on file",
                        item.provider ? `Provider: ${item.provider.name}` : null,
                        `Owner: ${item.assignedUserName}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span>
                        {item.workflowCount} {item.workflowCount === 1 ? "workflow" : "workflows"}
                      </span>
                      {item.client?.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone aria-hidden size={12} /> {item.client.phone}
                        </span>
                      ) : null}
                      {item.client?.timeZone ? <span>{item.client.timeZone}</span> : null}
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden
                    size={18}
                    className="shrink-0 text-slate-300 transition-colors group-hover:text-accent"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
