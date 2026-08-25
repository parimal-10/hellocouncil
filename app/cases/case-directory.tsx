"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { StatusBadge } from "./ui";

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
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search cases</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
          <input
            className="w-full rounded border border-line bg-white py-2 pl-9 pr-3 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search matter, client, provider, or phone"
            value={query}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {statuses.map((value) => (
            <button
              className={`rounded border px-3 py-1.5 text-sm ${
                status === value ? "border-accent bg-accent text-white" : "border-line bg-white text-muted"
              }`}
              key={value}
              onClick={() => setStatus(value)}
              type="button"
            >
              {value === "all" ? "All" : value.replaceAll("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted">
        {filtered.length} of {cases.length} {cases.length === 1 ? "case" : "cases"}
      </p>

      {filtered.length === 0 ? (
        <p className="rounded border border-line bg-white p-6 text-sm text-muted">No cases match that search.</p>
      ) : (
        <div className="overflow-hidden rounded border border-line bg-white">
          <ul className="divide-y divide-line">
            {filtered.map((item) => (
              <li key={item.id}>
                <Link className="block p-4 transition-colors hover:bg-panel" href={`/cases/${item.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium">{item.matterName}</p>
                      <p className="mt-1 text-sm text-muted">
                        {[
                          item.client ? `Client: ${item.client.name}` : "No client on file",
                          item.client?.phone,
                          item.provider ? `Provider: ${item.provider.name}` : null,
                          `Owner: ${item.assignedUserName}`,
                        ]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {item.workflowCount} {item.workflowCount === 1 ? "workflow" : "workflows"}
                        {item.client?.timeZone ? ` - Client timezone ${item.client.timeZone}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
