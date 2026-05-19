import { query, mutation, internalMutation, action, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { seedStarterWorkspace } from "./lib/starter";

/* ============================================================
   Agency — the super-admin layer. Creates and manages studio
   subaccounts (one Convex orgId / one Clerk Organization each).
   These functions are deliberately cross-org: they are not
   scoped by currentOrg().
   ============================================================ */

const planV = v.union(v.literal("solo"), v.literal("studio"), v.literal("label"));

/** Is the caller allowed into the agency console?
    Demo mode → open. With Clerk → an email allowlist (AGENCY_ADMIN_EMAILS). */
export const access = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { allowed: true, demo: true };
    const allow = (process.env.AGENCY_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const email = (identity.email ?? "").toLowerCase();
    return { allowed: allow.length === 0 || allow.includes(email), demo: false };
  },
});

/** Per-org rollup used by the subaccount list. */
async function rollup(ctx: QueryCtx, orgId: string) {
  const [rooms, sessions, payments] = await Promise.all([
    ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);
  return {
    roomCount: rooms.length,
    bookingCount: sessions.length,
    collectedCents: payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amountCents, 0),
  };
}

/** Every studio subaccount with a usage rollup. */
export const subaccounts = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return Promise.all(
      orgs.map(async (org) => ({
        ...org,
        status: org.status ?? "active",
        ...(await rollup(ctx, org.orgId)),
      })),
    );
  },
});

/** Cross-studio totals for the agency overview. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const sessions = await ctx.db.query("sessions").collect();
    const payments = await ctx.db.query("payments").collect();
    const collected = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amountCents, 0);
    return {
      studioCount: orgs.length,
      activeCount: orgs.filter((o) => (o.status ?? "active") === "active").length,
      bookingCount: sessions.length,
      collectedCents: collected,
      recent: orgs
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, 5)
        .map((o) => ({ orgId: o.orgId, name: o.name, slug: o.slug, createdAt: o._creationTime })),
    };
  },
});

/** One subaccount in full. */
export const subaccount = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return null;
    const activity = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(10);
    return { ...org, status: org.status ?? "active", ...(await rollup(ctx, orgId)), activity };
  },
});

/** Internal — create the org record and run the starter setup. */
export const provision = internalMutation({
  args: {
    orgId: v.string(),
    clerkOrgId: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    plan: planV,
    ownerName: v.string(),
    ownerEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const slugTaken = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (slugTaken) throw new Error(`The slug "${args.slug}" is already in use.`);

    await ctx.db.insert("orgs", {
      orgId: args.orgId,
      name: args.name,
      slug: args.slug,
      plan: args.plan,
      status: "active",
      accentColor: "#fdb913",
      tagline: "Where the record gets made.",
      bookingHeadline: `Book time at ${args.name}`,
      bookingIntro: "Pick a room, choose your time, and lock it in with a deposit.",
      depositPolicyText:
        "A deposit holds your booking. The balance is due up to 2 hours before your session.",
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      clerkOrgId: args.clerkOrgId,
      createdByAgency: true,
    });
    await seedStarterWorkspace(ctx, args.orgId, {
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
    });
    return { orgId: args.orgId };
  },
});

/**
 * Create a studio subaccount. When CLERK_SECRET_KEY is set this creates a
 * real Clerk Organization and emails the owner an invite; otherwise it
 * provisions a demo workspace with a synthetic org id. Either way the
 * Convex org record + starter setup are created.
 */
export const createSubaccount = action({
  args: {
    name: v.string(),
    slug: v.string(),
    plan: planV,
    ownerName: v.string(),
    ownerEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    let clerkOrgId: string | undefined;
    const secret = process.env.CLERK_SECRET_KEY;

    if (secret) {
      const orgRes = await fetch("https://api.clerk.com/v1/organizations", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: args.name, slug }),
      });
      if (!orgRes.ok) {
        throw new Error(`Clerk organization create failed (${orgRes.status}).`);
      }
      const org = (await orgRes.json()) as { id: string };
      clerkOrgId = org.id;
      // Invite the studio owner — non-fatal if it fails.
      await fetch(`https://api.clerk.com/v1/organizations/${clerkOrgId}/invitations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email_address: args.ownerEmail, role: "org:admin" }),
      }).catch(() => undefined);
    }

    const orgId = clerkOrgId ?? `studio_${slug}`;
    await ctx.runMutation(internal.agency.provision, {
      orgId,
      clerkOrgId,
      name: args.name,
      slug,
      plan: args.plan,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
    });
    return { orgId, slug, clerkProvisioned: Boolean(clerkOrgId) };
  },
});

export const setStatus = mutation({
  args: {
    orgId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("setup")),
  },
  handler: async (ctx, { orgId, status }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Subaccount not found");
    await ctx.db.patch(org._id, { status });
  },
});

/** Demo-mode "enter as" — point the workspace at a studio. With Clerk you
    switch organizations through Clerk instead. */
export const enterAs = mutation({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, { orgId }) => {
    const state = await ctx.db
      .query("appState")
      .withIndex("by_key", (q) => q.eq("key", "demo"))
      .first();
    if (state) {
      await ctx.db.patch(state._id, { activeOrgId: orgId });
    } else {
      await ctx.db.insert("appState", { key: "demo", activeOrgId: orgId });
    }
  },
});
