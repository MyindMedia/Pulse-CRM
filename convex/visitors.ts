import { query, mutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Visitors - the front-desk guest log.
   `register` is PUBLIC (the /visit/<slug> QR page): the org is
   derived from the slug, never from the caller, mirroring the
   public booking backend. Everything else requires a signed-in
   studio viewer via currentOrg.
   Every visit also upserts the contact into `artists` (deduped
   by lowercased email) so walk-ins land in the Clients directory
   as leads - the outreach database - without a parallel CRM.
   ============================================================ */

const HOURLY_CHECKIN_CAP = 60;

const registerFields = {
  name: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  purpose: v.optional(v.string()),
  hostName: v.optional(v.string()),
};

type RegisterArgs = {
  name: string;
  email: string;
  phone?: string;
  purpose?: string;
  hostName?: string;
};

/** Upsert the visitor into `artists` (dedup by lowercased email), then insert
    the visit row + an activity-feed entry. Shared by the public QR path and
    the staff manual-entry path. */
async function recordVisit(
  ctx: MutationCtx,
  orgId: string,
  args: RegisterArgs,
  source: "qr" | "front_desk",
): Promise<Id<"visitors">> {
  const name = args.name.trim();
  const email = args.email.trim().toLowerCase();
  if (!name) throw new Error("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
  const phone = args.phone?.trim() || undefined;
  const purpose = args.purpose?.trim() || undefined;
  const hostName = args.hostName?.trim() || undefined;

  // Dedup into the client database - same convention as public booking:
  // first-touch source wins, contact details fill in when missing.
  const existing = (
    await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  ).find((a) => a.email?.toLowerCase() === email);
  let artistId: Id<"artists">;
  if (existing) {
    artistId = existing._id;
    await ctx.db.patch(existing._id, {
      phone: phone ?? existing.phone,
      lastContactAt: Date.now(),
      source: existing.source ?? "visitor_qr",
      ...(existing.tags.includes("Visitor") ? {} : { tags: [...existing.tags, "Visitor"] }),
    });
  } else {
    artistId = await ctx.db.insert("artists", {
      orgId,
      name,
      type: "other",
      email,
      phone,
      genres: [],
      tags: ["Visitor"],
      status: "lead",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
      lastContactAt: Date.now(),
      source: "visitor_qr",
    });
  }

  const visitId = await ctx.db.insert("visitors", {
    orgId,
    name,
    email,
    phone,
    purpose,
    hostName,
    artistId,
    checkInAt: Date.now(),
    source,
  });

  await ctx.db.insert("activity", {
    orgId,
    kind: "visitor.checked_in",
    summary: `${name} checked in at the front desk${purpose ? ` - ${purpose}` : ""}`,
    entityType: "visitor",
    entityId: visitId,
    accent: "info",
  });

  return visitId;
}

/** PUBLIC - QR self check-in from /visit/<slug>. Org comes from the slug. */
export const register = mutation({
  args: { slug: v.string(), ...registerFields },
  handler: async (ctx, { slug, ...args }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org) throw new Error("This check-in link isn't active. Ask the front desk for help.");
    const orgId = org.orgId;

    // Abuse guard: an unauthenticated endpoint that writes CRM rows needs a
    // ceiling. 60 check-ins/org/hour is far above any real lobby's traffic.
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_org_period_metric", (q) =>
        q.eq("orgId", orgId).eq("period", hourBucket).eq("metric", "visitor_checkins"),
      )
      .first();
    if ((counter?.value ?? 0) >= HOURLY_CHECKIN_CAP) {
      throw new Error("Check-in is briefly paused - please ask the front desk to sign you in.");
    }

    const visitId = await recordVisit(ctx, orgId, args, "qr");

    if (counter) {
      await ctx.db.patch(counter._id, { value: counter.value + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("usageCounters", {
        orgId,
        period: hourBucket,
        metric: "visitor_checkins",
        value: 1,
        updatedAt: Date.now(),
      });
    }

    return { visitId };
  },
});

/** Staff manual entry from the Visitors screen (front desk signs someone in). */
export const registerManual = mutation({
  args: registerFields,
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const visitId = await recordVisit(ctx, orgId, args, "front_desk");
    return { visitId };
  },
});

/** Staff check-out - stamps the departure time. Idempotent. */
export const checkOut = mutation({
  args: { id: v.id("visitors") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const visit = await ctx.db.get(id);
    if (!visit || visit.orgId !== orgId) throw new Error("Not found");
    if (visit.checkOutAt) return; // already checked out - keep the first stamp
    await ctx.db.patch(id, { checkOutAt: Date.now() });
  },
});

/** The visit log, newest first. Optionally bounded to [from, to] check-in times. */
export const list = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    return ctx.db
      .query("visitors")
      .withIndex("by_org_checkin", (idx) => {
        const scoped = idx.eq("orgId", orgId);
        if (from !== undefined && to !== undefined) return scoped.gte("checkInAt", from).lte("checkInAt", to);
        if (from !== undefined) return scoped.gte("checkInAt", from);
        if (to !== undefined) return scoped.lte("checkInAt", to);
        return scoped;
      })
      .order("desc")
      .take(500);
  },
});

/** Unique visitors grouped by email - the outreach view. Newest-visit first. */
export const directory = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const visits = await ctx.db
      .query("visitors")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byEmail = new Map<
      string,
      {
        email: string;
        name: string;
        phone?: string;
        artistId?: Id<"artists">;
        visitCount: number;
        firstVisitAt: number;
        lastVisitAt: number;
      }
    >();
    for (const visit of visits) {
      const entry = byEmail.get(visit.email);
      if (!entry) {
        byEmail.set(visit.email, {
          email: visit.email,
          name: visit.name,
          phone: visit.phone,
          artistId: visit.artistId,
          visitCount: 1,
          firstVisitAt: visit.checkInAt,
          lastVisitAt: visit.checkInAt,
        });
      } else {
        entry.visitCount += 1;
        entry.firstVisitAt = Math.min(entry.firstVisitAt, visit.checkInAt);
        if (visit.checkInAt >= entry.lastVisitAt) {
          // The most recent visit's details are the freshest contact record.
          entry.lastVisitAt = visit.checkInAt;
          entry.name = visit.name;
          entry.phone = visit.phone ?? entry.phone;
          entry.artistId = visit.artistId ?? entry.artistId;
        }
      }
    }
    return [...byEmail.values()].sort((a, b) => b.lastVisitAt - a.lastVisitAt);
  },
});
