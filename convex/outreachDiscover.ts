import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import { parseSeed, isGenericInbox, hostOf } from "./outreach/enrich";
import { callTreg, parseMapsPlaces, parseIgUsers, parseIgContact, isAggregator, rankProfileEmail, type MapsPlace, type IgAccount } from "./outreach/treg";
import { cleanWebsite } from "./outreachProspects";

/* ============================================================
   Prospect discovery: find studios to pitch, through treg.
     - Google Maps search (anyapi.maps.contacts, about $0.001 per studio) returns
       the studio's website and the emails/phones published on it.
     - Instagram keyword search (treg.instagram.search.users, about $0.002 per
       search) returns public accounts with bio and website.
     - Instagram profile contact (anyapi.instagram.profile_contact, about $0.002)
       reads the email/phone the account itself publishes, on request.
   Results become outreachProspects. Nothing here sends anything. The treg
   token is a Convex env var and never reaches the browser.
   ============================================================ */

const MAX_QUERY = 80;
const DEFAULT_MAPS_LIMIT = 20;
/** Spend guards, per agency per rolling 24 hours. */
const DISCOVERIES_PER_DAY = 20;
const IG_CONTACT_LOOKUPS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const STUDIO_WORDS = /studio|record|mix|master|produc|music|audio|sound|podcast|rehears|engineer/i;

async function requireManager(ctx: Parameters<typeof requireAgencyScope>[0]) {
  const scope = await requireAgencyScope(ctx);
  if (!scope.canManage) throw new AccessError("FORBIDDEN", "Only an owner or admin can run discovery");
  return scope;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/* ------------------------------- queries ------------------------------- */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const scope = await agencyScope(ctx);
    if (!scope) return null;
    const rows = await ctx.db
      .query("outreachDiscoveries")
      .withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId))
      .order("desc")
      .take(20);
    return {
      canManage: scope.canManage,
      enabled: Boolean(process.env.TREG_TOKEN),
      rows: rows.map((r) => ({
        id: r._id, kind: r.kind, query: r.query, location: r.location ?? null, status: r.status,
        found: r.found, added: r.added, duplicates: r.duplicates, error: r.error ?? null, createdAt: r.createdAt,
      })),
    };
  },
});

/* ------------------------------ mutations ------------------------------ */

async function countSince(ctx: Parameters<typeof requireAgencyScope>[0], agencyId: string, action: string, since: number) {
  const events = await ctx.db
    .query("outreachEvents")
    .withIndex("by_agency", (q) => q.eq("agencyId", agencyId).gte("at", since))
    .collect();
  return events.filter((e) => e.action === action).length;
}

export const start = mutation({
  args: {
    kind: v.union(v.literal("maps"), v.literal("instagram")),
    query: v.string(),
    location: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    const query = clean(a.query);
    const location = a.location ? clean(a.location) : undefined;
    if (query.length < 2 || query.length > MAX_QUERY) throw new Error(`Search text must be 2 to ${MAX_QUERY} characters`);
    if (a.kind === "maps" && (!location || location.length < 2 || location.length > MAX_QUERY)) {
      throw new Error("A Google Maps search needs a city, for example Los Angeles, CA");
    }
    if (!process.env.TREG_TOKEN) throw new Error("Discovery is off: TREG_TOKEN is not set on this deployment.");
    const now = Date.now();
    if ((await countSince(ctx, scope.agencyId, "outreach.discover_started", now - DAY_MS)) >= DISCOVERIES_PER_DAY) {
      throw new Error(`Daily discovery limit reached (${DISCOVERIES_PER_DAY}). Try again tomorrow.`);
    }
    const limit = a.kind === "maps" ? Math.min(Math.max(Math.floor(a.limit ?? DEFAULT_MAPS_LIMIT), 1), 20) : 16;
    const jobId = await ctx.db.insert("outreachDiscoveries", {
      agencyId: scope.agencyId, kind: a.kind, query, location: a.kind === "maps" ? location : undefined,
      limit, status: "running", found: 0, added: 0, duplicates: 0, requestedBy: scope.actor, createdAt: now,
    });
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.discover_started", "ok", a.kind, `${query}${location ? ` in ${location}` : ""}`);
    await ctx.scheduler.runAfter(0, internal.outreachDiscover._run, { jobId });
    return { jobId };
  },
});

/** Reads the email and phone an Instagram account publishes on its own profile. */
export const findInstagramContact = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.agencyId !== scope.agencyId) throw new AccessError("FORBIDDEN", "Prospect not found");
    if (!row.handle) throw new Error("This prospect has no Instagram handle");
    if (row.status === "suppressed") throw new Error("This prospect opted out");
    if (!process.env.TREG_TOKEN) throw new Error("Discovery is off: TREG_TOKEN is not set on this deployment.");
    if ((await countSince(ctx, scope.agencyId, "outreach.ig_contact_requested", Date.now() - DAY_MS)) >= IG_CONTACT_LOOKUPS_PER_DAY) {
      throw new Error(`Daily Instagram lookup limit reached (${IG_CONTACT_LOOKUPS_PER_DAY}).`);
    }
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.ig_contact_requested", "ok", row.handle);
    await ctx.scheduler.runAfter(0, internal.outreachDiscover._igContact, { id });
    return null;
  },
});

/* --------------------------- internal (no client) --------------------------- */

export const _job = internalQuery({
  args: { jobId: v.id("outreachDiscoveries") },
  handler: async (ctx, { jobId }) => await ctx.db.get(jobId),
});

export const _finish = internalMutation({
  args: {
    jobId: v.id("outreachDiscoveries"),
    status: v.union(v.literal("done"), v.literal("failed")),
    found: v.number(), added: v.number(), duplicates: v.number(), error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job || job.status !== "running") return null;
    await ctx.db.patch(a.jobId, { status: a.status, found: a.found, added: a.added, duplicates: a.duplicates, error: a.error, finishedAt: Date.now() });
    await logEvent(ctx, job.agencyId, "system", "outreach.discover_finished", a.status === "done" ? "ok" : "denied", job.kind, a.error ?? `${a.added} added, ${a.duplicates} duplicate of ${a.found}`);
    return null;
  },
});

export const _run = internalAction({
  args: { jobId: v.id("outreachDiscoveries") },
  handler: async (ctx, { jobId }): Promise<null> => {
    const job = await ctx.runQuery(internal.outreachDiscover._job, { jobId });
    if (!job || job.status !== "running") return null;
    const fail = async (error: string): Promise<null> => {
      await ctx.runMutation(internal.outreachDiscover._finish, { jobId, status: "failed", found: 0, added: 0, duplicates: 0, error });
      return null;
    };
    if (job.kind === "maps") {
      const res = await callTreg("anyapi.maps.contacts", {
        query: job.query, location: job.location, limit: job.limit, website: "withWebsite",
      });
      if (!res.ok) return await fail(res.reason);
      const places = parseMapsPlaces(res.json);
      await ctx.runMutation(internal.outreachDiscover._ingestMaps, { jobId, places });
      return null;
    }
    const res = await callTreg("treg.instagram.search.users", { q: job.query });
    if (!res.ok) return await fail(res.reason);
    const accounts = parseIgUsers(res.json);
    await ctx.runMutation(internal.outreachDiscover._ingestInstagram, { jobId, accounts });
    return null;
  },
});

const placeV = v.object({
  name: v.string(), website: v.optional(v.string()), emails: v.array(v.string()), phones: v.array(v.string()),
  address: v.optional(v.string()), category: v.optional(v.string()), rating: v.optional(v.number()), reviewCount: v.optional(v.number()),
});

export const _ingestMaps = internalMutation({
  args: { jobId: v.id("outreachDiscoveries"), places: v.array(placeV) },
  handler: async (ctx, { jobId, places }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running") return null;
    let added = 0, duplicates = 0;
    const now = Date.now();
    for (const p of places as MapsPlace[]) {
      const site = p.website ? cleanWebsite(p.website) : null;
      const seed = site?.ok ? parseSeed(site.url) : null;
      const dedupeKey = seed?.dedupeKey ?? `maps:${p.name.toLowerCase()}|${(p.address ?? "").toLowerCase()}`;
      const dup = await ctx.db.query("outreachProspects").withIndex("by_agency_key", (q) => q.eq("agencyId", job.agencyId).eq("dedupeKey", dedupeKey)).unique();
      if (dup) { duplicates++; continue; }
      const host = site?.ok ? hostOf(site.url) : null;
      const sourceUrl = site?.ok ? site.url : "https://www.google.com/maps";
      const emails = p.emails.slice(0, 10).map((address) => {
        const domain = address.split("@")[1] ?? "";
        const own = !!host && (domain === host || domain.endsWith("." + host));
        return { address, generic: isGenericInbox(address), rank: (own ? 50 : 10) + (isGenericInbox(address) ? 0 : 3), sourceUrl };
      }).sort((x, y) => y.rank - x.rank);
      const hasContact = emails.length > 0;
      const note = [p.category, p.address, p.rating ? `${p.rating} stars${p.reviewCount ? ` (${p.reviewCount} reviews)` : ""}` : null].filter(Boolean).join(" · ");
      await ctx.db.insert("outreachProspects", {
        agencyId: job.agencyId, dedupeKey, name: p.name, websiteUrl: site?.ok ? site.url : undefined,
        source: "maps", status: hasContact ? "scraped" : site?.ok ? "ready_to_scrape" : "needs_website",
        note: note || undefined, category: p.category,
        contacts: hasContact || p.phones.length
          ? { emails, phones: p.phones.slice(0, 5).map((number) => ({ number, sourceUrl })), socials: [], booking: [], pages: [sourceUrl], scrapedAt: now }
          : undefined,
        createdAt: now, updatedAt: now,
      });
      added++;
    }
    await ctx.db.patch(jobId, { status: "done", found: places.length, added, duplicates, finishedAt: now });
    await logEvent(ctx, job.agencyId, "system", "outreach.discover_finished", "ok", "maps", `${added} added, ${duplicates} duplicate of ${places.length}`);
    return null;
  },
});

const accountV = v.object({
  handle: v.string(), name: v.optional(v.string()), bio: v.optional(v.string()), externalUrl: v.optional(v.string()),
  category: v.optional(v.string()), followers: v.optional(v.number()), isPrivate: v.boolean(),
});

export const _ingestInstagram = internalMutation({
  args: { jobId: v.id("outreachDiscoveries"), accounts: v.array(accountV) },
  handler: async (ctx, { jobId, accounts }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running") return null;
    let added = 0, duplicates = 0;
    const now = Date.now();
    for (const a of accounts as IgAccount[]) {
      // Keep it to accounts that read like studios; the search is a broad keyword match.
      if (!STUDIO_WORDS.test(`${a.category ?? ""} ${a.bio ?? ""} ${a.name ?? ""} ${a.handle}`)) continue;
      const dedupeKey = `ig:${a.handle}`;
      const dup = await ctx.db.query("outreachProspects").withIndex("by_agency_key", (q) => q.eq("agencyId", job.agencyId).eq("dedupeKey", dedupeKey)).unique();
      const trusted = a.externalUrl && !isAggregator(a.externalUrl) ? cleanWebsite(a.externalUrl) : null;
      if (dup) {
        if (dup.status === "needs_website" && trusted?.ok) {
          await ctx.db.patch(dup._id, { websiteUrl: trusted.url, status: "ready_to_scrape", bio: dup.bio ?? a.bio, category: dup.category ?? a.category, updatedAt: now });
        }
        duplicates++;
        continue;
      }
      const note = trusted?.ok ? undefined
        : a.externalUrl ? "Link-in-bio page: confirm the studio's real website."
        : "No website on the profile.";
      await ctx.db.insert("outreachProspects", {
        agencyId: job.agencyId, dedupeKey, handle: a.handle, name: a.name, websiteUrl: trusted?.ok ? trusted.url : undefined,
        source: "instagram_search", status: trusted?.ok ? "ready_to_scrape" : "needs_website", note,
        bio: a.bio, category: a.category, followers: a.followers, createdAt: now, updatedAt: now,
      });
      added++;
    }
    await ctx.db.patch(jobId, { status: "done", found: accounts.length, added, duplicates, finishedAt: now });
    await logEvent(ctx, job.agencyId, "system", "outreach.discover_finished", "ok", "instagram", `${added} added, ${duplicates} duplicate of ${accounts.length}`);
    return null;
  },
});

export const _igContact = internalAction({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }): Promise<null> => {
    const row = await ctx.runQuery(internal.outreachProspects._get, { id });
    if (!row?.handle) return null;
    const res = await callTreg("anyapi.instagram.profile_contact", { username: row.handle });
    const contact = res.ok ? parseIgContact(res.json) : null;
    await ctx.runMutation(internal.outreachDiscover._saveIgContact, {
      id, contact: contact ?? undefined, error: res.ok ? undefined : res.reason,
    });
    return null;
  },
});

export const _saveIgContact = internalMutation({
  args: {
    id: v.id("outreachProspects"),
    contact: v.optional(v.object({
      emails: v.array(v.string()), phones: v.array(v.string()),
      externalUrl: v.optional(v.string()), bio: v.optional(v.string()), name: v.optional(v.string()),
    })),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, contact, error }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status === "suppressed") return null;
    const now = Date.now();
    const profile = `https://www.instagram.com/${row.handle}/`;
    if (!contact) {
      await ctx.db.patch(id, { note: error ?? "No public email or phone on the Instagram profile.", updatedAt: now });
      await logEvent(ctx, row.agencyId, "system", "outreach.ig_contact_found", error ? "denied" : "ok", row.handle, error ?? "none published");
      return null;
    }
    const prev = row.contacts;
    const known = new Set((prev?.emails ?? []).map((e) => e.address));
    const emails = [...(prev?.emails ?? [])];
    for (const address of contact.emails) {
      if (known.has(address)) continue;
      emails.push({ address, generic: isGenericInbox(address), rank: rankProfileEmail(address), sourceUrl: profile });
    }
    emails.sort((a, b) => b.rank - a.rank);
    const phones = [...(prev?.phones ?? [])];
    for (const number of contact.phones) if (!phones.some((p) => p.number === number)) phones.push({ number, sourceUrl: profile });
    const trusted = contact.externalUrl && !isAggregator(contact.externalUrl) ? cleanWebsite(contact.externalUrl) : null;
    await ctx.db.patch(id, {
      contacts: {
        emails: emails.slice(0, 10), phones: phones.slice(0, 5), socials: prev?.socials ?? [], booking: prev?.booking ?? [],
        pages: [...new Set([...(prev?.pages ?? []), profile])], scrapedAt: now,
      },
      status: emails.length && (row.status === "needs_website" || row.status === "no_contact" || row.status === "ready_to_scrape") ? "scraped" : row.status,
      websiteUrl: row.websiteUrl ?? (trusted?.ok ? trusted.url : undefined),
      name: row.name ?? contact.name?.slice(0, 120),
      bio: row.bio ?? contact.bio?.slice(0, 300),
      note: undefined, updatedAt: now,
    });
    await logEvent(ctx, row.agencyId, "system", "outreach.ig_contact_found", "ok", row.handle, `${contact.emails.length} email, ${contact.phones.length} phone`);
    return null;
  },
});
