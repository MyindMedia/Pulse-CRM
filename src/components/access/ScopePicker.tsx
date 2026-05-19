"use client";

import * as React from "react";

type Sub = { orgId: string; name: string };

type Props = {
  subaccounts: Sub[];
  selected: string[];
  onChange: (orgIds: string[]) => void;
};

export function ScopePicker({ subaccounts, selected, onChange }: Props) {
  function toggle(orgId: string) {
    onChange(selected.includes(orgId)
      ? selected.filter((o) => o !== orgId)
      : [...selected, orgId]);
  }
  return (
    <div className="space-y-1 rounded border border-white/15 bg-black/30 p-3">
      <p className="text-xs text-white/60">
        Select which sub-accounts this staff member can reach.
      </p>
      <ul className="space-y-1">
        {subaccounts.map((s) => (
          <li key={s.orgId}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(s.orgId)}
                onChange={() => toggle(s.orgId)}
              />
              <span>{s.name}</span>
              <span className="text-xs text-white/40">{s.orgId}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-white/40">
        {selected.length} of {subaccounts.length} selected
      </p>
    </div>
  );
}
