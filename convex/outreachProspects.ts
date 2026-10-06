import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import type { Id } from "./_generated/dataModel";
import { prospectContactsV } from "./outreach/tables";
import { parseSeed, extractEmails, extractPhones, extractSocials, detectBooking, candidatePages, hostOf } from "./outreach/enrich";
import { checkUrl, robotsPermits, safeGet } from "./outreach/safeFetch";

/* ============================================================
   Outreach prospects: studios to pitch, found from Instagram handles or
   websites. Contact data comes only from the studio's own public website
   (never from Instagram) and is "published, not verified". Nothing here sends
   an email; a prospect only moves to "queued" for human review.
   ============================================================ */

const MAX_LINES = 200;
const MAX_QUEUE_LIST = 300;

async function requireManager(ctx: Parameters<typeof requireAgencyScope>[0]) {
  const scope = await requireAgencyScope(ctx);
  if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can manage prospects");
  return scope;
}

async function ownedProspect(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string, id: Id<"outreachProspects">) {
  const row = await ctx.db.get(id);
  if (!row || row.agencyId !== agencyId) throw new AccessError("FORBIDDEN", "Prospect not found");
  return row;
}

/** Normalises a user-supplied site to scheme://host[/path] or returns an error. */
export function cleanWebsite(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const chk = checkUrl(withScheme);
  if (!chk.ok) return chk;
  return { ok: true, url: `${chk.url.protocol}//${chk.url.hostname}${chk.url.pathname === "/" ? "" : chk.url.pathname.replace(/\/$/, "")}` };
}

/* ------------------------------- queries ------------------------------- */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db
      .query("outreachProspects")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .order("desc")
      .take(MAX_QUEUE_LIST);
    const sup = await ctx.db
      .query("outreachSuppressions")
      .withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId))
      .collect();
    const suppressed = new Set(sup.map((s) => s.email));
    return {
      canManage: scope.canManage,
      suppressedCount: sup.length,
      rows: rows.map((r) => ({
        id: r._id,
        handle: r.handle ?? null,
        name: r.name ?? null,
        websiteUrl: r.websiteUrl ?? null,
        source: r.source,
        status: r.status,
        note: r.note ?? null,
        bookedAt: r.bookedAt ?? null,
        createdAt: r.createdAt,
        contacts: r.contacts
          ? {
              emails: r.contacts.emails.map((e) => ({ ...e, suppressed: suppressed.has(e.address) })),
              phones: r.contacts.phones,
              socials: r.contacts.socials,
              booking: r.contacts.booking,
              scrapedAt: r.contacts.scrapedAt,
            }
          : null,
      })),
    };
  },
});

/* ------------------------------ mutations ------------------------------ */

/** Paste a list of handles, Instagram links or websites. */
export const add = mutation({
  args: { lines: v.array(v.string()) },
  handler: async (ctx, { lines }) => {
    const scope = await requireManager(ctx);
    if (lines.length > MAX_LINES) throw new Error(`Add at most ${MAX_LINES} at a time`);
    let added = 0, duplicates = 0, invalid = 0;
    const now = Date.now();
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const seed = parseSeed(raw);
      if (!seed) { invalid++; continue; }
      const dup = await ctx.db
        .query("outreachProspects")
        .withIndex("by_agency_key", (q) => q.eq("agencyId", scope.agencyId).eq("dedupeKey", seed.dedupeKey))
        .unique();
      if (dup) { duplicates++; continue; }
      let websiteUrl: string | undefined;
      let status: "needs_website" | "ready_to_scrape" | "blocked" = "needs_website";
      let note = seed.note;
      if (seed.websiteUrl) {
        const w = cleanWebsite(seed.websiteUrl);
        if (w.ok) { websiteUrl = w.url; status = "ready_to_scrape"; }
        else { status = "blocked"; note = w.reason; }
      }
      await ctx.db.insert("outreachProspects", {
        agencyId: scope.agencyId, dedupeKey: seed.dedupeKey, handle: seed.handle, websiteUrl,
        source: "paste", status, note, createdAt: now, updatedAt: now,
      });
      added++;
    }
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospects_added", "ok", undefined, `${added} added, ${duplicates} duplicate, ${invalid} invalid`);
    return { added, duplicates, invalid };
  },
});

/** The operator confirms the studio's website (a guess is never trusted). */
export const setWebsite = mutation({
  args: { id: v.id("outreachProspects"), url: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, a.id);
    if (row.status === "scraping") throw new Error("A scrape is running for this prospect");
    const w = cleanWebsite(a.url);
    if (!w.ok) throw new Error(w.reason);
    await ctx.db.patch(row._id, {
      websiteUrl: w.url, name: a.name?.trim().slice(0, 120) || row.name, status: "ready_to_scrape",
      note: undefined, contacts: undefined, updatedAt: Date.now(),
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospect_website_set", "ok", row.handle ?? row.dedupeKey, hostOf(w.url) ?? undefined);
    return null;
  },
});

export const requestScrape = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, id);
    if (!row.websiteUrl) throw new Error("Confirm the website first");
    if (row.status === "scraping") return null;
    await ctx.db.patch(id, { status: "scraping", note: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.outreachProspects._scrape, { id });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospect_scrape_requested", "ok", row.handle ?? row.dedupeKey);
    return null;
  },
});

/** Moves a prospect to the review queue. It never sends anything. */
export const queueForReview = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, id);
    if (row.status !== "scraped" || !row.contacts) throw new Error("Only a scraped prospect can be queued");
    const sup = await ctx.db
      .query("outreachSuppressions")
      .withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId))
      .collect();
    const blocked = new Set(sup.map((s) => s.email));
    if (!row.contacts.emails.some((e) => !blocked.has(e.address))) throw new Error("Every found address is suppressed");
    await ctx.db.patch(id, { status: "queued", updatedAt: Date.now() });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospect_queued", "ok", row.handle ?? row.dedupeKey);
    return null;
  },
});

export const suppressEmail = mutation({
  args: { email: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const email = a.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Not an email address");
    const exists = await ctx.db
      .query("outreachSuppressions")
      .withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId).eq("email", email))
      .unique();
    if (!exists) await ctx.db.insert("outreachSuppressions", { agencyId: scope.agencyId, email, reason: a.reason.slice(0, 200), at: Date.now() });
    const rows = await ctx.db.query("outreachProspects").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).take(500);
    const sup = new Set((await ctx.db.query("outreachSuppressions").withIndex("by_agency_email", (q) => q.eq("agencyId", scope.agencyId)).collect()).map((s) => s.email));
    for (const r of rows) {
      if (r.status === "queued" && r.contacts && r.contacts.emails.every((e) => sup.has(e.address))) {
        await ctx.db.patch(r._id, { status: "suppressed", updatedAt: Date.now() });
      }
    }
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.email_suppressed", "ok", email);
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, id);
    await ctx.db.delete(row._id);
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospect_removed", "ok", row.handle ?? row.dedupeKey);
    return null;
  },
});

/* ----------------------- scrape (internal, no client) ----------------------- */

export const _get = internalQuery({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const _save = internalMutation({
  args: {
    id: v.id("outreachProspects"),
    outcome: v.union(v.literal("scraped"), v.literal("no_contact"), v.literal("blocked")),
    contacts: v.optional(prospectContactsV),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.status !== "scraping") return null;
    await ctx.db.patch(a.id, { status: a.outcome, contacts: a.contacts, note: a.note, updatedAt: Date.now() });
    await logEvent(ctx, row.agencyId, "system", "outreach.prospect_scraped", a.outcome === "blocked" ? "denied" : "ok", row.handle ?? row.dedupeKey, a.note ?? a.outcome);
    return null;
  },
});

/** Reads the studio's own public pages (home plus up to two contact/about
 *  pages), politely: robots.txt first, sequential requests, size and time caps. */
export const _scrape = internalAction({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.outreachProspects._get, { id });
    if (!row || !row.websiteUrl) return null;
    const fail = async (outcome: "blocked" | "no_contact", note: string) => {
      await ctx.runMutation(internal.outreachProspects._save, { id, outcome, note });
      return null;
    };
    const start = checkUrl(row.websiteUrl);
    if (!start.ok) return await fail("blocked", start.reason);
    const robots = await robotsPermits(start.url.origin, start.url.pathname || "/");
    if (!robots.ok) return await fail("blocked", robots.reason);
    const home = await safeGet(start.url.href);
    if (!home.ok) return await fail("blocked", `Could not read the site (${home.reason})`);

    const siteHost = hostOf(home.url);
    const pages: Array<{ url: string; html: string }> = [{ url: home.url, html: home.html }];
    for (const extra of candidatePages(home.html, home.url, 2)) {
      const ex = checkUrl(extra);
      if (!ex.ok) continue;
      const ok = await robotsPermits(ex.url.origin, ex.url.pathname);
      if (!ok.ok) continue;
      const r = await safeGet(extra);
      if (r.ok) pages.push({ url: r.url, html: r.html });
    }

    const emails = new Map<string, { address: string; generic: boolean; rank: number; sourceUrl: string }>();
    const phones = new Map<string, { number: string; sourceUrl: string }>();
    const socials = new Map<string, { platform: string; url: string }>();
    const booking = new Set<string>();
    for (const p of pages) {
      for (const e of extractEmails(p.html, siteHost)) if (!emails.has(e.address)) emails.set(e.address, { ...e, sourceUrl: p.url });
      for (const ph of extractPhones(p.html)) if (!phones.has(ph.number)) phones.set(ph.number, { number: ph.number, sourceUrl: p.url });
      for (const s of extractSocials(p.html)) if (!socials.has(s.url)) socials.set(s.url, s);
      for (const b of detectBooking(p.html)) booking.add(b);
    }
    const sorted = [...emails.values()].sort((a, b) => b.rank - a.rank).slice(0, 10);
    const contacts = {
      emails: sorted,
      phones: [...phones.values()].slice(0, 5),
      socials: [...socials.values()].slice(0, 8),
      booking: [...booking],
      pages: pages.map((p) => p.url),
      scrapedAt: Date.now(),
    };
    await ctx.runMutation(internal.outreachProspects._save, {
      id, outcome: sorted.length ? "scraped" : "no_contact", contacts,
      note: sorted.length ? undefined : "No published email found on the pages read.",
    });
    return null;
  },
});

/* --------------------------- intake (HTTP/helper) --------------------------- */

/** Used by the secured intake endpoint (iPhone shortcut and the local Instaloader
 *  helper). The agency comes from server configuration, never from the caller. */
export const intakeProspect = internalMutation({
  args: {
    agencyId: v.string(),
    line: v.string(),
    website: v.optional(v.string()),
    name: v.optional(v.string()),
    source: v.union(v.literal("shortcut"), v.literal("instaloader")),
  },
  handler: async (ctx, a) => {
    const seed = parseSeed(a.line);
    if (!seed) return { result: "invalid" as const };
    const existing = await ctx.db
      .query("outreachProspects")
      .withIndex("by_agency_key", (q) => q.eq("agencyId", a.agencyId).eq("dedupeKey", seed.dedupeKey))
      .unique();
    const siteRaw = a.website ?? seed.websiteUrl;
    const site = siteRaw ? cleanWebsite(siteRaw) : null;
    const now = Date.now();
    if (existing) {
      // A helper may supply the website for a handle that was waiting for one.
      if (existing.status === "needs_website" && site?.ok) {
        await ctx.db.patch(existing._id, { websiteUrl: site.url, status: "ready_to_scrape", name: a.name?.slice(0, 120) ?? existing.name, updatedAt: now });
        return { result: "updated" as const };
      }
      return { result: "duplicate" as const };
    }
    await ctx.db.insert("outreachProspects", {
      agencyId: a.agencyId, dedupeKey: seed.dedupeKey, handle: seed.handle,
      name: a.name?.slice(0, 120), websiteUrl: site?.ok ? site.url : undefined,
      source: a.source, status: site?.ok ? "ready_to_scrape" : "needs_website",
      note: seed.note ?? (site && !site.ok ? site.reason : undefined), createdAt: now, updatedAt: now,
    });
    await logEvent(ctx, a.agencyId, a.source, "outreach.prospect_intake", "ok", seed.handle ?? seed.dedupeKey);
    return { result: "added" as const };
  },
});
