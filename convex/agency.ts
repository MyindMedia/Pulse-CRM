import { query, mutation, internalMutation, internalQuery, action, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { seedStarterWorkspace } from "./lib/starter";
import { resolveViewer, requireCapability, AccessError } from "./lib/access";
import { PLAN_LIMITS, type TierKey } from "./lib/plans";
import { sendEmail } from "./lib/email";
import { inviteEmailHtml, inviteEmailSubject } from "./lib/emailTemplates/invite";

/* ============================================================
   Agency - the super-admin layer. Creates and manages studio
   subaccounts (one Convex orgId / one Clerk Organization each).
   These functions are deliberately cross-org: they are not
   scoped by currentOrg().
   ============================================================ */

const planV = v.union(v.literal("solo"), v.literal("studio"), v.literal("label"));

/** Is the caller allowed into the agency console?
    Demo mode → open. Real Clerk identity → must be an agency member. */
export const access = query({
  args: {},
  handler: async (ctx) => {
    try {
      const viewer = await resolveViewer(ctx);
      // Real agency members always allowed
      if (viewer.kind === "agency_member") return { allowed: true, demo: false };
      // Demo path (no Clerk identity) returns true to keep the existing UX
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) return { allowed: true, demo: true };
      // Backwards-compat: email allowlist for projects that still use it
      const allow = (process.env.AGENCY_ADMIN_EMAILS ?? "")
        .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const email = (identity.email ?? "").toLowerCase();
      return { allowed: allow.length === 0 || allow.includes(email), demo: false };
    } catch (e) {
      if (e instanceof AccessError) return { allowed: false, demo: false };
      throw e;
    }
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

/** Cross-studio totals for the agency overview. Now includes a 12-month
 * revenue rollup, subscriber-tier breakdown, cross-tenant pipeline
 * stages, outreach activity, and a top-studios leaderboard. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const sessions = await ctx.db.query("sessions").collect();
    const payments = await ctx.db.query("payments").collect();
    const invoices = await ctx.db.query("invoices").collect();
    const opportunities = await ctx.db.query("opportunities").collect();
    const activity = await ctx.db.query("activity").collect();

    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const collected = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amountCents, 0);
    const collectedThisMonth = payments
      .filter((p) => p.status === "paid" && p._creationTime >= monthStart.getTime())
      .reduce((s, p) => s + p.amountCents, 0);

    // 12-month revenue chart - bucket payments by their creation month.
    const months: { month: string; ts: number; revenue: number }[] = [];
    const ref = new Date();
    ref.setDate(1);
    ref.setHours(0, 0, 0, 0);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(ref);
      d.setMonth(d.getMonth() - i);
      months.push({
        month: d.toLocaleString("en-US", { month: "short" }),
        ts: d.getTime(),
        revenue: 0,
      });
    }
    for (const p of payments) {
      if (p.status !== "paid") continue;
      for (let i = months.length - 1; i >= 0; i--) {
        if (p._creationTime >= months[i].ts) {
          months[i].revenue += p.amountCents / 100;
          break;
        }
      }
    }

    // Subscriber breakdown by plan tier.
    const tiers = new Map<string, number>();
    for (const o of orgs) {
      const plan = o.plan ?? "solo";
      tiers.set(plan, (tiers.get(plan) ?? 0) + 1);
    }
    const subscribersByPlan = Array.from(tiers.entries()).map(([plan, count]) => ({
      plan,
      count,
    }));

    // Cross-tenant pipeline rollup by stage.
    const stageCounts = new Map<string, number>();
    const stageValue = new Map<string, number>();
    for (const opp of opportunities) {
      const stage = opp.stage ?? "inquiry";
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
      stageValue.set(stage, (stageValue.get(stage) ?? 0) + (opp.valueCents ?? 0));
    }
    const pipelineByStage = Array.from(stageCounts.entries()).map(([stage, count]) => ({
      stage,
      count,
      valueCents: stageValue.get(stage) ?? 0,
    }));
    const pipelineValueCents = Array.from(stageValue.values()).reduce((s, v) => s + v, 0);

    // Outreach: aggregate activity events in the last 30 days, grouped by kind prefix.
    const THIRTY = now - 30 * 86_400_000;
    const recentTouches = activity.filter((a) => a._creationTime >= THIRTY).length;
    const outreachByKind = new Map<string, number>();
    for (const a of activity) {
      if (a._creationTime < THIRTY) continue;
      const key = a.kind.split(".")[0];
      outreachByKind.set(key, (outreachByKind.get(key) ?? 0) + 1);
    }
    const outreachBreakdown = Array.from(outreachByKind.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);

    // Top studios by lifetime collected revenue.
    const studioRollups = new Map<string, { collected: number; sessions: number }>();
    for (const p of payments) {
      if (p.status !== "paid") continue;
      const r = studioRollups.get(p.orgId) ?? { collected: 0, sessions: 0 };
      r.collected += p.amountCents;
      studioRollups.set(p.orgId, r);
    }
    for (const s of sessions) {
      const r = studioRollups.get(s.orgId) ?? { collected: 0, sessions: 0 };
      r.sessions += 1;
      studioRollups.set(s.orgId, r);
    }
    const topStudios = orgs
      .map((o) => ({
        orgId: o.orgId,
        name: o.name,
        plan: o.plan ?? "solo",
        slug: o.slug,
        collectedCents: studioRollups.get(o.orgId)?.collected ?? 0,
        sessions: studioRollups.get(o.orgId)?.sessions ?? 0,
      }))
      .sort((a, b) => b.collectedCents - a.collectedCents)
      .slice(0, 5);

    // Outstanding + overdue cash across all studios.
    const outstandingCents = invoices
      .filter((i) => i.status !== "paid" && i.status !== "void")
      .reduce((s, i) => s + i.amountCents, 0);
    const overdueCents = invoices
      .filter(
        (i) =>
          (i.status === "sent" || i.status === "viewed" || i.status === "overdue") &&
          i.dueDate < now,
      )
      .reduce((s, i) => s + i.amountCents, 0);

    return {
      // Headline KPIs
      studioCount: orgs.length,
      activeCount: orgs.filter((o) => (o.status ?? "active") === "active").length,
      bookingCount: sessions.length,
      collectedCents: collected,
      collectedThisMonthCents: collectedThisMonth,
      pipelineValueCents,
      pipelineCount: opportunities.length,
      outstandingCents,
      overdueCents,
      recentTouches,
      // Charts
      revenueTrend: months.map((m) => ({ month: m.month, revenue: m.revenue })),
      subscribersByPlan,
      pipelineByStage,
      outreachBreakdown,
      // Lists
      topStudios,
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

/** Internal - create the org record and run the starter setup. */
export const provision = internalMutation({
  args: {
    orgId: v.string(),
    clerkOrgId: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    plan: planV,
    ownerName: v.string(),
    ownerEmail: v.string(),
    agencyId: v.optional(v.string()),
    tier: v.optional(v.union(v.literal("studio"), v.literal("pro"), v.literal("agency"))),
  },
  handler: async (ctx, args) => {
    const slugTaken = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (slugTaken) throw new ConvexError(`The slug "${args.slug}" is already in use.`);

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
      agencyId: args.agencyId,
      tier: args.tier ?? "studio",
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
    try {
      const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (slug.length < 2) {
        throw new ConvexError("Pick a slug with at least 2 characters.");
      }

      // Validate slug uniqueness FIRST - before creating any external (Clerk)
      // resource. Otherwise a late failure (e.g. duplicate slug caught in
      // provision) orphans a freshly created Clerk organization.
      if (await ctx.runQuery(internal.agency._slugTaken, { slug })) {
        throw new ConvexError(`The slug "${slug}" is already in use. Pick another.`);
      }

      // Capability + plan-cap check.
      const self = await ctx.runQuery(internal.agency._resolveSelf, {});
      if (self && self.kind === "agency_member") {
        // Real agency tenant - enforce the plan cap. If the agencies row is
        // missing (a known provisioning gap) we do NOT block creation; we just
        // skip the cap rather than throwing an opaque "record not found".
        const ag = await ctx.runQuery(internal.agency._agencyById, { agencyId: self.agencyId! });
        if (ag) {
          const tier: TierKey = ag.plan in PLAN_LIMITS ? (ag.plan as TierKey) : "agency";
          const cap = PLAN_LIMITS[tier].subAccountCap;
          const count = await ctx.runQuery(internal.agency._countSubaccounts, {
            agencyId: self.agencyId!,
          });
          if (count >= cap) {
            throw new ConvexError(
              `Plan cap reached (${count}/${cap} studios). Upgrade your plan to add more.`,
            );
          }
        }
      }
      // Demo / single-tenant path: no cap, no agency required.

      let clerkOrgId: string | undefined;
      const secret = process.env.CLERK_SECRET_KEY;

      if (secret) {
        // Note: we do NOT send `slug` to Clerk. Some instances disable
        // organization slugs (error: organization_slugs_disabled); Clerk
        // auto-generates one. Our own routing slug lives on the Convex org.
        let orgRes: Response;
        try {
          orgRes = await fetch("https://api.clerk.com/v1/organizations", {
            method: "POST",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: args.name }),
          });
        } catch (netErr) {
          throw new ConvexError(
            `Could not reach Clerk to create the organization: ${
              netErr instanceof Error ? netErr.message : "network error"
            }`,
          );
        }
        if (!orgRes.ok) {
          const detail = await orgRes.text().catch(() => "");
          let msg = `Clerk organization create failed (${orgRes.status}).`;
          try {
            const parsed = JSON.parse(detail) as { errors?: { long_message?: string; message?: string }[] };
            const m = parsed.errors?.[0]?.long_message ?? parsed.errors?.[0]?.message;
            if (m) msg = `Clerk organization create failed: ${m}`;
          } catch {
            // non-JSON body; keep the status-only message
          }
          throw new ConvexError(msg);
        }
        const org = (await orgRes.json()) as { id: string };
        clerkOrgId = org.id;
      }

      const orgId = clerkOrgId ?? `studio_${slug}`;
      const agencyId = self?.kind === "agency_member" ? self.agencyId : undefined;
      await ctx.runMutation(internal.agency.provision, {
        orgId,
        clerkOrgId,
        name: args.name,
        slug,
        plan: args.plan,
        ownerName: args.ownerName,
        ownerEmail: args.ownerEmail,
        agencyId,
        tier: "studio",
      });

      // Branded beta invite (NON-FATAL): the subaccount is already provisioned,
      // so an invite/email hiccup must never fail the whole action.
      let inviteSent = false;
      try {
        const inviteIdentity = await ctx.auth.getUserIdentity();
        const issuer = inviteIdentity?.subject ?? "system";
        const appUrl = process.env.APP_URL ?? "http://localhost:3000";
        const token = await ctx.runMutation(internal.invites.record, {
          orgId,
          clerkOrgId,
          agencyId,
          email: args.ownerEmail,
          ownerName: args.ownerName,
          studioName: args.name,
          invitedBy: issuer,
          emailStatus: "simulated", // updated below after send
        });
        const acceptUrl = `${appUrl}/invite/${token}`;
        const status = await sendEmail({
          to: args.ownerEmail,
          subject: inviteEmailSubject(args.name),
          html: inviteEmailHtml({
            ownerName: args.ownerName,
            studioName: args.name,
            inviterName: "your Pulse administrator",
            acceptUrl,
            logoUrl: `${appUrl}/pulse-logo.png`,
          }),
        });
        await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });
        inviteSent = status === "sent";
      } catch (inviteErr) {
        console.error("[createSubaccount] invite step failed (non-fatal):", inviteErr);
      }

      return { orgId, slug, clerkProvisioned: Boolean(clerkOrgId), inviteSent };
    } catch (err) {
      // Surface the REAL reason to the client. Convex redacts plain Error
      // messages to a generic "Server Error"; ConvexError data always reaches
      // the caller. Anything unexpected is also logged for the deployment logs.
      if (err instanceof ConvexError) throw err;
      console.error("[createSubaccount] unexpected failure:", err);
      throw new ConvexError(
        err instanceof Error
          ? `Subaccount creation failed: ${err.message}`
          : "Subaccount creation failed.",
      );
    }
  },
});

export const setStatus = mutation({
  args: {
    orgId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("setup")),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Subaccount not found");
    await ctx.db.patch(org._id, { status });
  },
});

// ── Internal helpers used by the createSubaccount cap check ──────
export const _resolveSelf = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      const v = await resolveViewer(ctx);
      if (v.kind === "agency_member") {
        return { kind: "agency_member" as const, agencyId: v.agencyId, role: v.role };
      }
      return { kind: v.kind };
    } catch { return null; }
  },
});

export const _agencyById = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) =>
    await ctx.db.query("agencies").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).first(),
});

export const _countSubaccounts = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) =>
    (await ctx.db.query("orgs").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect()).length,
});

export const _slugTaken = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) =>
    Boolean(
      await ctx.db.query("orgs").withIndex("by_slug", (q) => q.eq("slug", slug)).first(),
    ),
});

/** Demo-mode "enter as" - point the workspace at a studio. With Clerk you
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

/**
 * Operator bootstrap - promote a signed-up Clerk user to agency owner of an
 * existing Clerk organization. Idempotent. Internal: run by an operator via
 *   npx convex run agency:seedAgencyOwner '{"agencyId":"org_...", ...}'
 *
 * Prerequisites for the user to actually resolve as an agency_member (see
 * resolveViewer): the Clerk org must have publicMetadata.type="agency" and the
 * user must be a member of that Clerk org with it as their active org. This
 * mutation seeds only the Convex side (agencies + agencyMembers owner rows);
 * the Clerk-side org type + membership are set via the Clerk API.
 */
export const seedAgencyOwner = internalMutation({
  args: {
    agencyId: v.string(), // Clerk org id (org_...)
    name: v.string(),
    slug: v.string(),
    ownerClerkUserId: v.string(),
    ownerEmail: v.string(),
    plan: v.optional(v.union(v.literal("pro"), v.literal("agency"), v.literal("agency_plus"))),
  },
  handler: async (ctx, args) => {
    const plan = args.plan ?? "agency";
    const existingAg = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .first();
    if (existingAg) {
      await ctx.db.patch(existingAg._id, {
        name: args.name, slug: args.slug, plan, status: "active",
        ownerClerkUserId: args.ownerClerkUserId, ownerEmail: args.ownerEmail,
      });
    } else {
      await ctx.db.insert("agencies", {
        agencyId: args.agencyId, name: args.name, slug: args.slug, plan,
        status: "active", ownerClerkUserId: args.ownerClerkUserId, ownerEmail: args.ownerEmail,
      });
    }

    const existingMem = await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency_clerk", (q) =>
        q.eq("agencyId", args.agencyId).eq("clerkUserId", args.ownerClerkUserId))
      .first();
    if (existingMem) {
      await ctx.db.patch(existingMem._id, {
        role: "owner", status: "active", email: args.ownerEmail, name: args.ownerEmail,
      });
    } else {
      await ctx.db.insert("agencyMembers", {
        agencyId: args.agencyId, clerkUserId: args.ownerClerkUserId,
        email: args.ownerEmail, name: args.ownerEmail, role: "owner",
        status: "active", invitedAt: Date.now(),
      });
    }
    return { agencyId: args.agencyId, ownerClerkUserId: args.ownerClerkUserId, plan };
  },
});
