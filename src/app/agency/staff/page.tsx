"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { RolePicker } from "@/components/access/RolePicker";

export default function StaffPage() {
  const members = useQuery(api.agencyStaff.list, {});
  const invite = useMutation(api.agencyStaff.invite);
  const setRole = useMutation(api.agencyStaff.setRole);
  const remove = useMutation(api.agencyStaff.remove);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRoleSel] = React.useState("staff");
  const [err, setErr] = React.useState("");

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!name || !email) return;
    try {
      await invite({
        name, email,
        role: role as "owner" | "admin" | "staff" | "billing",
      });
      setName(""); setEmail("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invite failed");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-bone">Agency staff</h1>
        <p className="text-sm text-ash">
          Invite teammates, set their role, and scope them to specific sub-accounts.
        </p>
      </header>

      <form
        onSubmit={onInvite}
        className="space-y-3 rounded-lg border border-hairline bg-coal/40 p-4"
      >
        <h2 className="text-base font-medium text-bone">Invite a staff member</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            type="email"
            className="rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
          />
          <RolePicker layer="agency" value={role} onChange={setRoleSel} />
        </div>
        {err && <p className="text-xs text-critical">{err}</p>}
        <button
          type="submit"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright"
        >
          Send invite
        </button>
      </form>

      <section className="rounded-lg border border-hairline bg-coal/40">
        <h2 className="border-b border-hairline p-4 text-base font-medium text-bone">All members</h2>
        <ul className="divide-y divide-hairline">
          {(members ?? []).map((m) => (
            <li
              key={m._id}
              className="grid grid-cols-[1fr_minmax(200px,auto)_auto] items-center gap-3 p-4"
            >
              <div>
                <p className="text-sm font-medium text-bone">{m.name}</p>
                <p className="text-xs text-ash-dim">{m.email}</p>
                <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
                  {m.status}
                </p>
              </div>
              <RolePicker
                layer="agency"
                value={m.role}
                onChange={(v) =>
                  setRole({
                    memberId: m._id,
                    role: v as "owner" | "admin" | "staff" | "billing",
                  })
                }
                disabled={m.role === "owner"}
              />
              <div className="flex gap-2">
                {m.role === "staff" && (
                  <a
                    href={`/agency/staff/${m._id}`}
                    className="rounded border border-hairline-2 px-2 py-1 text-xs text-ash hover:text-bone"
                  >
                    Scope…
                  </a>
                )}
                <button
                  onClick={() => remove({ memberId: m._id })}
                  disabled={m.role === "owner"}
                  className="rounded border border-critical/30 px-2 py-1 text-xs text-critical disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
