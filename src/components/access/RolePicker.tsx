"use client";

import * as React from "react";

const AGENCY_ROLES = [
  { value: "owner",   label: "Owner",   desc: "Full control, billing, agency settings" },
  { value: "admin",   label: "Admin",   desc: "Everything except billing + delete agency" },
  { value: "staff",   label: "Staff",   desc: "Scoped to specific sub-accounts" },
  { value: "billing", label: "Billing", desc: "Billing surface only" },
] as const;

const STUDIO_ROLES = [
  { value: "owner",              label: "Owner",              desc: "Runs the studio; full control" },
  { value: "manager",            label: "Manager",            desc: "Bookings, clients, members" },
  { value: "engineer",           label: "Engineer",           desc: "Runs sessions, edits songs and deliverables" },
  { value: "assistant_engineer", label: "Assistant Engineer", desc: "Narrower scope; own sessions only" },
  { value: "artist_relations",   label: "Artist Relations",   desc: "Booker / front-of-house; CRM access" },
  { value: "producer",           label: "Producer",           desc: "Runs sessions; signs split sheets" },
  { value: "intern",             label: "Intern",             desc: "Read-only across the board" },
  { value: "accountant",         label: "Accountant",         desc: "Invoices, payments, refunds - no creative" },
] as const;

type Props = {
  layer: "agency" | "studio";
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
};

export function RolePicker({ layer, value, onChange, disabled }: Props) {
  const roles = layer === "agency" ? AGENCY_ROLES : STUDIO_ROLES;
  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
      >
        {roles.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <p className="text-xs text-white/60">
        {roles.find((r) => r.value === value)?.desc ?? ""}
      </p>
    </div>
  );
}
