import { MutationCtx } from "../_generated/server";

/* ============================================================
   Starter workspace — the initial setup the agency runs when a
   new studio subaccount is created. Two bookable rooms with sane
   defaults and the owner as the first team member, so the studio
   is usable the moment it is provisioned.
   ============================================================ */

export async function seedStarterWorkspace(
  ctx: MutationCtx,
  orgId: string,
  opts: { ownerName: string; ownerEmail: string },
): Promise<void> {
  await ctx.db.insert("members", {
    orgId,
    name: opts.ownerName,
    email: opts.ownerEmail,
    role: "owner",
    skills: [],
  });

  await ctx.db.insert("rooms", {
    orgId,
    name: "Studio A",
    roomType: "Live room",
    hourlyRateCents: 12000,
    status: "available",
    bookable: true,
    minimumHours: 2,
    depositPct: 30,
    condition: "Default room — rename and price it in Studio settings.",
  });
  await ctx.db.insert("rooms", {
    orgId,
    name: "Mix Room",
    roomType: "Mix suite",
    hourlyRateCents: 8000,
    status: "available",
    bookable: true,
    minimumHours: 2,
    depositPct: 30,
  });

  await ctx.db.insert("activity", {
    orgId,
    kind: "studio.created",
    summary: "Studio workspace created — add gear, team and branding to get going.",
    accent: "gold",
  });
}
