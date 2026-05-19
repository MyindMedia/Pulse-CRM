"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ScopePicker } from "@/components/access/ScopePicker";
import { CapabilityOverrides } from "@/components/access/CapabilityOverrides";

export default function StaffScopePage() {
  const { id } = useParams<{ id: string }>();
  const memberId = id as Id<"agencyMembers">;
  const members = useQuery(api.agencyStaff.list, {});
  const subaccounts = useQuery(api.agency.subaccounts);
  const scopes = useQuery(api.agencyStaff.scopes, { memberId });
  const setScopes = useMutation(api.agencyStaff.setScopes);
  const setRole = useMutation(api.agencyStaff.setRole);

  const member = members?.find((m) => m._id === memberId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [overrides, setOverrides] = React.useState<string[]>([]);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (scopes) setSelected(scopes.map((s) => s.subAccountOrgId));
  }, [scopes]);
  React.useEffect(() => {
    if (member) setOverrides(member.capabilityOverrides ?? []);
  }, [member]);

  async function save() {
    await setScopes({ memberId, subAccountOrgIds: selected });
    if (member) {
      await setRole({
        memberId,
        role: member.role,
        capabilityOverrides: overrides,
      });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (!member) return <p className="p-6 text-sm text-ash">Loading…</p>;

  return (
    <div className="space-y-6">
      <header>
        <a href="/agency/staff" className="text-xs text-ash-dim hover:text-bone">
          ← Back to staff
        </a>
        <h1 className="mt-2 font-display text-2xl font-semibold text-bone">{member.name}</h1>
        <p className="text-sm text-ash">
          {member.email} · {member.role}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-medium text-bone">Sub-account access</h2>
        <ScopePicker
          subaccounts={(subaccounts ?? []).map((s) => ({ orgId: s.orgId, name: s.name }))}
          selected={selected}
          onChange={setSelected}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium text-bone">Permission overrides</h2>
        <CapabilityOverrides overrides={overrides} onChange={setOverrides} />
      </section>

      <button
        onClick={save}
        className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright"
      >
        {saved ? "Saved." : "Save"}
      </button>
    </div>
  );
}
