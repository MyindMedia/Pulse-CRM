import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AccessError } from "./lib/access";
import { agencyScope, requireAgencyScope, logEvent } from "./outreach/scope";
import type { Id } from "./_generated/dataModel";
import { prospectContactsV } from "./outreach/tables";
import { parseSeed, extractEmails, extractPhones, extractSocials, detectBooking, candidatePages, hostOf, isContactPath } from "./outreach/enrich";
import { checkUrl, loadRobots, robotsVerdict, safeGet, type RobotsPolicy } from "./outreach/safeFetch";
import { stopSequencesFor, suppressionStopReason, STOP_MEANING } from "./outreach/sequence";
import { GENERIC_HOLD } from "./outreach/drafting";
import { readImportRows, rowProblem } from "./outreach/csvImport";

/* ============================================================
   Outreach prospects: studios to pitch, found from Instagram handles or
   websites. Contact data comes only from the studio's own public website
   (never from Instagram) and is "published, not verified". Nothing here sends
   an email; a prospect only moves to "queued" for human review.
   ============================================================ */

const MAX_LINES = 200;
const MAX_QUEUE_LIST = 300;
const MAX_BULK = 200;
/** How many prospects a CSV import can match against. */
const MAX_IMPORT_MATCH = 2000;
const OPEN_DRAFT = new Set(["draft", "hold", "approved"]);

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

/** The key a website matches on: its host, lowercased, without "www." (as parseSeed's site: dedupe key). */
export function websiteKey(raw: string): string | null {
  const w = cleanWebsite(raw);
  return w.ok ? hostOf(w.url) : null;
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
    const seqs = await ctx.db
      .query("outreachSequences")
      .withIndex("by_agency_recipient", (q) => q.eq("agencyId", scope.agencyId))
      .collect();
    const seqByProspect = new Map(seqs.map((s) => [String(s.prospectId), s]));
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
        repliedAt: r.repliedAt ?? null,
        routingConfirmed: r.routingConfirmed ?? false,
        hook: r.hook ?? null,
        hookSourceUrl: r.hookSourceUrl ?? null,
        subjectDefault: r.subjectDefault ?? null,
        bodyDefault: r.bodyDefault ?? null,
        hasFollowupOverrides: Boolean(r.followups && (r.followups.step1 || r.followups.step2 || r.followups.step3)),
        fitScore: r.fitScore ?? null,
        priority: r.priority ?? null,
        sequence: (() => {
          const s = seqByProspect.get(String(r._id));
          return s
            ? { step: s.step, status: s.status, nextDueAt: s.nextDueAt ?? null, recipient: s.recipient, stoppedReason: s.stoppedReason ?? null,
                stoppedMeaning: s.stoppedReason ? STOP_MEANING[s.stoppedReason] : null, pendingDraft: Boolean(s.pendingDraftId) }
            : null;
        })(),
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
    await stopSequencesFor(ctx, scope.agencyId, { email }, suppressionStopReason(a.reason), scope.actor);
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.email_suppressed", "ok", email);
    return null;
  },
});

/** The studio replied: stop the follow-ups. MaxB can still reply in the thread. */
export const markReplied = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, id);
    if (row.status === "replied") return null;
    if (row.status === "suppressed") throw new Error("This studio opted out");
    const now = Date.now();
    await ctx.db.patch(id, { status: "replied", repliedAt: now, updatedAt: now });
    await stopSequencesFor(ctx, scope.agencyId, { prospectId: id }, "replied", scope.actor);
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.prospect_replied", "ok", row.handle ?? row.dedupeKey);
    return null;
  },
});

/** Owner/admin: Lawrence checked who handles studio operations behind these
 *  prospects' generic inboxes. Records who and when, and clears the generic-inbox
 *  hold on their open drafts. It never approves anything. */
export const confirmRouting = mutation({
  args: { ids: v.array(v.id("outreachProspects")), confirmed: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const scope = await requireManager(ctx);
    if (a.ids.length === 0) throw new Error("Select at least one studio");
    if (a.ids.length > MAX_BULK) throw new Error(`Confirm at most ${MAX_BULK} at a time`);
    const confirmed = a.confirmed ?? true;
    const now = Date.now();
    let changed = 0, holdsCleared = 0;
    for (const id of new Set(a.ids)) {
      const row = await ownedProspect(ctx, scope.agencyId, id);
      await ctx.db.patch(id, confirmed
        ? { routingConfirmed: true, routingConfirmedBy: scope.actor, routingConfirmedAt: now, updatedAt: now }
        : { routingConfirmed: false, routingConfirmedBy: undefined, routingConfirmedAt: undefined, updatedAt: now });
      changed++;
      if (confirmed) {
        for (const d of await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", id)).collect()) {
          if (d.status === "hold" && d.holdReason === GENERIC_HOLD) {
            await ctx.db.patch(d._id, { status: "draft", holdReason: undefined });
            holdsCleared++;
          }
        }
      }
      await logEvent(ctx, scope.agencyId, scope.actor, confirmed ? "outreach.routing_confirmed" : "outreach.routing_unconfirmed", "ok", row.handle ?? row.dedupeKey);
    }
    return { changed, holdsCleared };
  },
});

/** Owner/admin: per-studio copy from the outreach CSV, matched by website. Updates
 *  existing prospects only (never creates one) and never imports an email address
 *  as a contact. A changed hook, subject or body voids the open Lawrence draft, and
 *  a changed follow-up voids that step's open draft, so nothing approved goes out
 *  with copy that has since been edited. */
export const importCsv = mutation({
  args: { csv: v.string() },
  handler: async (ctx, { csv }) => {
    const scope = await requireManager(ctx);
    if (csv.length > 2_000_000) throw new Error("The file is too large");
    const rows = readImportRows(csv);
    const prospects = await ctx.db.query("outreachProspects").withIndex("by_agency", (q) => q.eq("agencyId", scope.agencyId)).take(MAX_IMPORT_MATCH);
    const byKey = new Map<string, Array<(typeof prospects)[number]>>();
    for (const p of prospects) {
      const keys = new Set<string>();
      if (p.websiteUrl) { const k = hostOf(p.websiteUrl); if (k) keys.add(k); }
      if (p.dedupeKey.startsWith("site:")) keys.add(p.dedupeKey.slice(5));
      for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    const now = Date.now();
    const seen = new Set<string>();
    let matched = 0, draftsVoided = 0;
    const unmatched: string[] = [];
    const skipped: Array<{ line: number; reason: string }> = [];
    for (const r of rows) {
      const problem = rowProblem(r);
      if (problem) { skipped.push({ line: r.line, reason: problem }); continue; }
      const key = websiteKey(r.website);
      if (!key) { skipped.push({ line: r.line, reason: "not a public website" }); continue; }
      if (seen.has(key)) { skipped.push({ line: r.line, reason: "website repeated in this file" }); continue; }
      seen.add(key);
      const hits = byKey.get(key) ?? [];
      if (hits.length === 0) { unmatched.push(key); continue; }
      if (hits.length > 1) { skipped.push({ line: r.line, reason: "more than one prospect has this website" }); continue; }
      const p = hits[0];
      // A blank cell keeps what is there.
      const followups = {
        step1: r.followups.step1 ?? p.followups?.step1,
        step2: r.followups.step2 ?? p.followups?.step2,
        step3: r.followups.step3 ?? p.followups?.step3,
      };
      const next = {
        hook: r.hook ?? p.hook, hookSourceUrl: r.hookSourceUrl ?? p.hookSourceUrl,
        subjectDefault: r.subject ?? p.subjectDefault, bodyDefault: r.body ?? p.bodyDefault,
        igDmDraft: r.igDm ?? p.igDmDraft, fitScore: r.fitScore ?? p.fitScore, priority: r.priority ?? p.priority,
      };
      await ctx.db.patch(p._id, { ...next, followups, updatedAt: now });
      matched++;
      const step0Changed = next.hook !== p.hook || next.subjectDefault !== p.subjectDefault || next.bodyDefault !== p.bodyDefault;
      const stepChanged = [0, followups.step1 !== p.followups?.step1, followups.step2 !== p.followups?.step2, followups.step3 !== p.followups?.step3];
      if (step0Changed || stepChanged.some(Boolean)) {
        for (const d of await ctx.db.query("outreachDrafts").withIndex("by_prospect", (q) => q.eq("prospectId", p._id)).collect()) {
          if (!OPEN_DRAFT.has(d.status) || d.sequenceStep === undefined) continue;
          if ((d.sequenceStep === 0 && step0Changed) || (d.sequenceStep >= 1 && stepChanged[d.sequenceStep])) {
            await ctx.db.patch(d._id, { status: "superseded" });
            draftsVoided++;
          }
        }
      }
    }
    await logEvent(ctx, scope.agencyId, scope.actor, "outreach.csv_imported", "ok", undefined,
      `${matched} matched, ${unmatched.length} unmatched, ${skipped.length} skipped, ${draftsVoided} drafts voided`);
    return { matched, unmatched: unmatched.length, skipped: skipped.length, draftsVoided, unmatchedWebsites: unmatched.slice(0, 20), skippedRows: skipped.slice(0, 20) };
  },
});

export const remove = mutation({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const scope = await requireManager(ctx);
    const row = await ownedProspect(ctx, scope.agencyId, id);
    await stopSequencesFor(ctx, scope.agencyId, { prospectId: row._id }, "manual", scope.actor);
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
    outcome: v.union(v.literal("scraped"), v.literal("no_contact"), v.literal("blocked"), v.literal("unreachable")),
    contacts: v.optional(prospectContactsV),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.status !== "scraping") return null;
    await ctx.db.patch(a.id, { status: a.outcome, contacts: a.contacts, note: a.note, updatedAt: Date.now() });
    await logEvent(ctx, row.agencyId, "system", "outreach.prospect_scraped", a.outcome === "blocked" ? "denied" : a.outcome === "unreachable" ? "unknown" : "ok", row.handle ?? row.dedupeKey, a.note ?? a.outcome);
    return null;
  },
});

/** Reads the studio's own public pages (home plus up to two contact/about
 *  pages), politely: robots.txt first, sequential requests, size and time caps.
 *
 *  robots.txt semantics (RFC 9309): a served file is honoured, including an
 *  explicit Disallow, which blocks. 404/410 means there is no file, so nothing
 *  is disallowed. A 5xx or network failure is retried with backoff and then
 *  never hard-blocks: we read only the homepage and contact pages and say so
 *  in the note. A site that cannot be reached at all is "unreachable", not
 *  "blocked". Contact info is only ever what the studio published itself. */
export const _scrape = internalAction({
  args: { id: v.id("outreachProspects") },
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.outreachProspects._get, { id });
    if (!row || !row.websiteUrl) return null;
    const fail = async (outcome: "blocked" | "no_contact" | "unreachable", note: string) => {
      await ctx.runMutation(internal.outreachProspects._save, { id, outcome, note });
      return null;
    };
    const start = checkUrl(row.websiteUrl);
    if (!start.ok) return await fail("blocked", start.reason);
    const host = start.url.hostname;

    const policies = new Map<string, RobotsPolicy>();
    const policyFor = async (origin: string) => {
      let p = policies.get(origin);
      if (!p) {
        p = await loadRobots(origin);
        policies.set(origin, p);
        if (p.kind !== "unreachable" && p.origin !== origin) policies.set(p.origin, p);
        if (p.kind === "unreachable") console.warn("outreach robots unreachable", origin, p.failKind, p.detail ?? "");
      }
      return p;
    };
    let limitedReason: string | null = null;
    let overHttp = false;

    const first = await policyFor(start.url.origin);
    if (first.kind === "unreachable" && first.failKind === "dns") {
      return await fail("unreachable", `${host} does not resolve (no DNS record). Check the address.`);
    }
    let target = start.url;
    if (first.kind !== "unreachable" && first.downgraded) {
      target = new URL(start.url.href.replace(/^https:/i, "http:"));
      overHttp = true;
    }
    const verdict = robotsVerdict(first, target.pathname);
    if (verdict === "disallow") return await fail("blocked", "robots.txt disallows this page");
    if (verdict === "limited" && first.kind === "unreachable") {
      limitedReason = first.reason;
      if (target.pathname !== "/" && !isContactPath(target.pathname)) target = new URL("/", target);
    }

    const home = await safeGet(target.href, { httpFallback: true });
    if (!home.ok) {
      console.warn("outreach site unreachable", target.href, home.kind, home.detail ?? "");
      return await fail("unreachable", home.kind === "dns"
        ? `${host} does not resolve (no DNS record). Check the address.`
        : `Could not read the site (${home.reason}).`);
    }
    if (home.downgraded) overHttp = true;
    const homeUrl = new URL(home.url);
    if (homeUrl.origin !== target.origin) {
      // The homepage redirected to another origin (often apex to www): its own robots.txt applies.
      const p = await policyFor(homeUrl.origin);
      const v2 = robotsVerdict(p, homeUrl.pathname);
      if (v2 === "disallow") return await fail("blocked", "robots.txt disallows this page");
      if (v2 === "limited" && p.kind === "unreachable") limitedReason ??= p.reason;
    }

    const siteHost = hostOf(home.url);
    const pages: Array<{ url: string; html: string }> = [{ url: home.url, html: home.html }];
    for (const extra of candidatePages(home.html, home.url, 2)) {
      const ex = checkUrl(extra);
      if (!ex.ok) continue;
      const p = await policyFor(ex.url.origin);
      const v3 = robotsVerdict(p, ex.url.pathname);
      if (v3 === "disallow") continue;
      // candidatePages only returns contact/about/booking pages, so a limited read may take them.
      if (v3 === "limited" && p.kind === "unreachable") limitedReason ??= p.reason;
      const r = await safeGet(extra);
      if (r.ok) pages.push({ url: r.url, html: r.html });
    }

    const readNotes: string[] = [];
    if (limitedReason) readNotes.push(`${limitedReason}, so only the homepage and contact pages were read.`);
    if (overHttp) readNotes.push("The site has no working HTTPS, so it was read over HTTP.");

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
    const headline = sorted.length ? "Published contact info found. Not verified." : "No published email found on the pages read.";
    await ctx.runMutation(internal.outreachProspects._save, {
      id, outcome: sorted.length ? "scraped" : "no_contact", contacts,
      note: readNotes.length ? [headline, ...readNotes].join(" ") : sorted.length ? undefined : headline,
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
