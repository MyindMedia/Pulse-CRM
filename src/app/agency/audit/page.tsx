"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export default function AuditPage() {
  const [resultFilter, setResultFilter] = React.useState<"" | "allow" | "deny">("");
  const [actionFilter, setActionFilter] = React.useState("");
  const rows = useQuery(api.audit.list, {
    limit: 200,
    actionFilter: actionFilter || undefined,
    resultFilter: resultFilter || undefined,
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-bone">Audit log</h1>
        <p className="text-sm text-ash">
          Every sensitive action across your sub-accounts.
        </p>
      </header>
      <div className="flex gap-3">
        <input
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          placeholder="action prefix (e.g. members.)"
          className="rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
        />
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as "" | "allow" | "deny")}
          className="rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
        >
          <option value="">All results</option>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-coal/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
              <th className="p-3">When</th>
              <th className="p-3">Viewer</th>
              <th className="p-3">Action</th>
              <th className="p-3">Org</th>
              <th className="p-3">Result</th>
              <th className="p-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {(rows ?? []).map((r) => (
              <tr key={r._id}>
                <td className="p-3 text-xs text-ash-dim">
                  {new Date(r._creationTime).toLocaleString()}
                </td>
                <td className="p-3 text-xs text-ash">{r.viewerId}</td>
                <td className="p-3 font-mono text-xs text-bone">{r.action}</td>
                <td className="p-3 text-xs text-ash-dim">{r.orgId ?? "-"}</td>
                <td className="p-3 text-xs">
                  <span className={r.result === "allow" ? "text-positive" : "text-critical"}>
                    {r.result}
                  </span>
                </td>
                <td className="p-3 text-xs text-ash-dim">{r.reason ?? ""}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-ash-dim">
                  No audit events yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
