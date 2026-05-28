/* ============================================================
   Ops Autopilot - the operations brain.

   Runs per org on a schedule (see crons.ts). It reads the studio's
   live operational state, derives a set of candidate actions with a
   deterministic rule layer (so it works with no OpenAI key), and
   upserts them into `opsActions` for one-tap approval. Action types
   the owner has graduated to "auto" execute immediately, bounded by a
   per-org daily cap.

   This module is V8-runtime (no OpenAI SDK): the deterministic rules
   are the product's safety floor. Copy enrichment via OpenAI can layer
   on later without changing this contract.
   ============================================================ */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { invoicePayUrl } from "./lib/links";
import {
  leadCandidates,
  prepCandidates,
  recapCandidates,
  revisionTriageCandidates,
  pricingCandidates,
  noShowCandidates,
  weakLeadSourceCandidates,
  type LeadSignal,
  type PrepSessionSignal,
  type RecapSessionSignal,
  type RevisionTriageSignal,
  type PricingOppSignal,
  type NoShowRiskSignal,
  type WeakLeadSourceSignal,
} from "./agents/generators";

const DAY = 86_400_000;
const QUIET_DAYS = 90;
const CONFIRM_HORIZON = 3 * DAY;
const UPCOMING_WINDOW = 7 * DAY;
const DAILY_AUTO_CAP = 20;

// Named-agent gather windows.
const PREP_HORIZON = 2 * DAY; // sessions starting within 48h get a prep packet
const RECAP_LOOKBACK = 2 * DAY; // sessions completed in the last 48h get a recap
const NOSHOW_HORIZON = 2 * DAY; // upcoming sessions at no-show risk
const REVISION_MIN_OPEN = 3; // open notes before we triage
const PRICING_WINDOW = 8 * 7 * DAY; // 8 weeks for utilization
const PRICING_BOOKABLE_HOURS = 12 * 7 * 8; // 12h/day * 7 days * 8 weeks

function fmtCents(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}
function firstName(name: string): string {
  return name.split(" ")[0] || name;
}

export type ActionType =
  | "reengage_quiet_artist"
  | "payment_reminder"
  | "confirm_unconfirmed_session"
  | "promote_underused_room"
  | "resolve_revision_overflow"
  | "chase_split_sheet"
  | "deposit_unpaid_nudge"
  // Named-agent action types (unified approval inbox)
  | "convert_lead"
  | "session_prep_packet"
  | "post_session_recap"
  | "revision_triage"
  | "complete_rights_metadata"
  | "pricing_opportunity"
  | "no_show_risk"
  | "weak_lead_source"
  | "waitlist_fill";

export type Priority = "low" | "medium" | "high";

export type Payload =
  | { kind: "email"; to?: string; subject: string; body: string; notifyKind: string }
  | { kind: "session_status"; sessionId: Id<"sessions">; newStatus: "confirmed" | "cancelled" }
  | { kind: "note_only" };

export type ProposedAction = {
  type: ActionType;
  priority: Priority;
  title: string;
  rationale: string;
  entityType?: string;
  entityId?: string;
  payload: Payload;
};

/** The operational state the brain reasons over. Plain data so the rule
 * layer (candidatesFor) stays pure and unit-testable. */
export type Signals = {
  now: number;
  orgName: string;
  quietArtists: { id: Id<"artists">; name: string; email?: string }[];
  overdueInvoices: { id: Id<"invoices">; number: string; amountCents: number; artistName: string; email?: string }[];
  unconfirmedSessions: { id: Id<"sessions">; title: string; startTime: number; artistName: string }[];
  depositUnpaid: { id: Id<"sessions">; title: string; artistName: string; email?: string }[];
  revisionOverflow: { id: Id<"songs">; title: string }[];
  splitSheetChase: { id: Id<"songs">; title: string }[];
  underusedRooms: { id: Id<"rooms">; name: string }[];
  // Named-agent signals.
  newLeads: LeadSignal[];
  upcomingPrep: PrepSessionSignal[];
  recentlyCompleted: RecapSessionSignal[];
  revisionTriage: RevisionTriageSignal[];
  rightsMetadataGaps: { id: Id<"songs">; title: string; missing: string[] }[];
  pricingRooms: PricingOppSignal[];
  noShowRisks: NoShowRiskSignal[];
  weakLeadSources: WeakLeadSourceSignal[];
};

/** Pure rule layer: operational signals -> candidate actions. */
export function candidatesFor(s: Signals): ProposedAction[] {
  const out: ProposedAction[] = [];

  for (const a of s.quietArtists) {
    out.push({
      type: "reengage_quiet_artist",
      priority: "medium",
      title: `Re-engage ${a.name}`,
      rationale: `No contact in ${QUIET_DAYS}+ days. A short check-in keeps them from churning.`,
      entityType: "artist",
      entityId: a.id,
      payload: a.email
        ? {
            kind: "email",
            to: a.email,
            subject: "We'd love to have you back in the studio",
            body: `Hi ${firstName(a.name)}, it has been a while since your last session and we have been thinking about your music. If you have something in the works, we would love to help you finish it. Want to grab a date?`,
            notifyKind: "artist.reengage",
          }
        : { kind: "note_only" },
    });
  }

  for (const inv of s.overdueInvoices) {
    out.push({
      type: "payment_reminder",
      priority: "high",
      title: `Chase invoice ${inv.number}`,
      rationale: `Invoice ${inv.number} for ${fmtCents(inv.amountCents)} is past due.`,
      entityType: "invoice",
      entityId: inv.id,
      payload: inv.email
        ? {
            kind: "email",
            to: inv.email,
            subject: `Friendly reminder: invoice ${inv.number} is past due`,
            body: `Hi ${firstName(inv.artistName)}, just a quick nudge that invoice ${inv.number} for ${fmtCents(inv.amountCents)} is now past due.\n\nYou can pay it securely right here: ${invoicePayUrl(inv.id)}\n\nAlready paid? Please disregard. Questions? Just reply here.`,
            notifyKind: "invoice.reminder",
          }
        : { kind: "note_only" },
    });
  }

  for (const sess of s.unconfirmedSessions) {
    out.push({
      type: "confirm_unconfirmed_session",
      priority: "high",
      title: `Confirm ${sess.title}`,
      rationale: `${sess.artistName}'s session is within ${CONFIRM_HORIZON / DAY} days and still tentative. Confirm it to lock the room.`,
      entityType: "session",
      entityId: sess.id,
      payload: { kind: "session_status", sessionId: sess.id, newStatus: "confirmed" },
    });
  }

  for (const sess of s.depositUnpaid) {
    out.push({
      type: "deposit_unpaid_nudge",
      priority: "medium",
      title: `Deposit unpaid - ${sess.title}`,
      rationale: `${sess.artistName}'s public booking is holding without a deposit. Nudge before the hold expires.`,
      entityType: "session",
      entityId: sess.id,
      payload: sess.email
        ? {
            kind: "email",
            to: sess.email,
            subject: "Secure your booking - deposit needed",
            body: `Hi ${firstName(sess.artistName)}, your hold for "${sess.title}" is still open. Pay the deposit to lock it in before the slot is released.`,
            notifyKind: "deposit.nudge",
          }
        : { kind: "note_only" },
    });
  }

  for (const song of s.revisionOverflow) {
    out.push({
      type: "resolve_revision_overflow",
      priority: "medium",
      title: `${song.title} is over its revision budget`,
      rationale: "Revisions used meet or exceed the included count. Consider invoicing for extra revisions before more notes come in.",
      entityType: "song",
      entityId: song.id,
      payload: { kind: "note_only" },
    });
  }

  for (const song of s.splitSheetChase) {
    out.push({
      type: "chase_split_sheet",
      priority: "high",
      title: `Split sheet not locked - ${song.title}`,
      rationale: `${song.title} is near delivery but its split sheet is not fully executed. Lock it before release.`,
      entityType: "song",
      entityId: song.id,
      payload: { kind: "note_only" },
    });
  }

  for (const room of s.underusedRooms) {
    out.push({
      type: "promote_underused_room",
      priority: "low",
      title: `Promote ${room.name}`,
      rationale: `${room.name} has no bookings in the next ${UPCOMING_WINDOW / DAY} days. Run a rate-cut promo to fill it.`,
      entityType: "room",
      entityId: room.id,
      payload: { kind: "note_only" },
    });
  }

  for (const song of s.rightsMetadataGaps) {
    out.push({
      type: "complete_rights_metadata",
      priority: "high",
      title: `Rights metadata incomplete - ${song.title}`,
      rationale: `${song.title} is near release but is missing ${song.missing.join(", ")}. Lock the rights metadata before distribution.`,
      entityType: "song",
      entityId: song.id,
      payload: { kind: "note_only" },
    });
  }

  // Named agents (deterministic fallbacks; OpenAI enriches the bodies later).
  out.push(...leadCandidates(s.newLeads, s.now));
  out.push(...prepCandidates(s.upcomingPrep));
  out.push(...recapCandidates(s.recentlyCompleted));
  out.push(...revisionTriageCandidates(s.revisionTriage));
  out.push(...pricingCandidates(s.pricingRooms));
  out.push(...noShowCandidates(s.noShowRisks));
  out.push(...weakLeadSourceCandidates(s.weakLeadSources));

  return out;
}

/** Read the studio's live operational state. */
export async function gatherSignals(ctx: MutationCtx, orgId: string): Promise<Signals> {
  const now = Date.now();

  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  const orgName = org?.name ?? "the studio";

  const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const artistMap = new Map(artists.map((a) => [a._id, a] as const));

  const quietArtists = artists
    .filter((a) => (a.status === "active" || a.status === "vip") && a.lastContactAt && now - a.lastContactAt > QUIET_DAYS * DAY)
    .slice(0, 10)
    .map((a) => ({ id: a._id, name: a.name, email: a.email }));

  const invoices = await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const overdueInvoices = invoices
    .filter((i) => i.status === "overdue" || (i.status === "sent" && i.dueDate < now))
    .slice(0, 10)
    .map((i) => {
      const artist = artistMap.get(i.artistId);
      return { id: i._id, number: i.number, amountCents: i.amountCents, artistName: artist?.name ?? "the client", email: artist?.email };
    });

  const sessions = await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const unconfirmedSessions = sessions
    .filter((sess) => sess.status === "tentative" && sess.startTime > now && sess.startTime <= now + CONFIRM_HORIZON)
    .slice(0, 10)
    .map((sess) => ({ id: sess._id, title: sess.title, startTime: sess.startTime, artistName: artistMap.get(sess.artistId)?.name ?? "the artist" }));
  const depositUnpaid = sessions
    .filter((sess) => sess.source === "public_booking" && sess.status === "tentative" && !sess.depositPaid && sess.holdExpiresAt && sess.holdExpiresAt > now)
    .slice(0, 10)
    .map((sess) => ({ id: sess._id, title: sess.title, artistName: artistMap.get(sess.artistId)?.name ?? "the artist", email: artistMap.get(sess.artistId)?.email }));

  // Rooms with no upcoming booking in the next 7 days.
  const roomsWithUpcoming = new Set<string>();
  for (const sess of sessions) {
    if (!sess.roomId) continue;
    if (sess.startTime > now && sess.startTime <= now + UPCOMING_WINDOW && (sess.status === "tentative" || sess.status === "confirmed" || sess.status === "in_progress")) {
      roomsWithUpcoming.add(sess.roomId);
    }
  }
  const rooms = await ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const underusedRooms = rooms
    .filter((r) => r.bookable !== false && r.status !== "retired" && !roomsWithUpcoming.has(r._id))
    .slice(0, 10)
    .map((r) => ({ id: r._id, name: r.name }));

  const songs = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const revisionOverflow = songs
    .filter((song) => song.revisionsIncluded > 0 && song.revisionsUsed >= song.revisionsIncluded)
    .slice(0, 10)
    .map((song) => ({ id: song._id, title: song.title }));

  const splitSheets = await ctx.db.query("splitSheets").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const sheetBySong = new Map(splitSheets.map((sh) => [sh.songId, sh] as const));
  const NEAR_DELIVERY = new Set(["mixing", "mastering", "delivered"]);
  const splitSheetChase = songs
    .filter((song) => NEAR_DELIVERY.has(song.stage) && sheetBySong.get(song._id)?.status !== "fully_executed")
    .slice(0, 10)
    .map((song) => ({ id: song._id, title: song.title }));

  // ── Named agents ──────────────────────────────────────────────

  // Booking Conversion: artists still in "lead" status with no session yet.
  const sessionsByArtist = new Set(sessions.map((sess) => sess.artistId));
  const newLeads: LeadSignal[] = artists
    .filter((a) => a.status === "lead" && !sessionsByArtist.has(a._id))
    .slice(0, 10)
    .map((a) => ({ id: a._id, name: a.name, email: a.email, source: a.source, genres: a.genres ?? [], createdAt: a._creationTime }));

  // Session Prep: confirmed/tentative sessions starting within the prep horizon.
  const roomById = new Map(rooms.map((r) => [r._id, r] as const));
  const engineers = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const engineerById = new Map(engineers.map((m) => [m._id, m] as const));
  const upcomingPrep: PrepSessionSignal[] = sessions
    .filter((sess) => (sess.status === "confirmed" || sess.status === "tentative") && sess.startTime > now && sess.startTime <= now + PREP_HORIZON)
    .slice(0, 10)
    .map((sess) => ({
      id: sess._id,
      title: sess.title,
      startTime: sess.startTime,
      artistName: artistMap.get(sess.artistId)?.name ?? "the artist",
      serviceType: sess.serviceType,
      roomName: sess.roomId ? roomById.get(sess.roomId)?.name : undefined,
      engineerName: sess.engineerId ? engineerById.get(sess.engineerId)?.name : undefined,
    }));

  // Post-Session Recap: sessions that completed within the lookback window.
  const songById = new Map(songs.map((song) => [song._id, song] as const));
  const recentlyCompleted: RecapSessionSignal[] = sessions
    .filter((sess) => sess.status === "completed" && sess.endTime <= now && sess.endTime > now - RECAP_LOOKBACK)
    .slice(0, 10)
    .map((sess) => ({
      id: sess._id,
      title: sess.title,
      endTime: sess.endTime,
      artistName: artistMap.get(sess.artistId)?.name ?? "the artist",
      artistEmail: artistMap.get(sess.artistId)?.email,
      songTitle: sess.songId ? songById.get(sess.songId)?.title : undefined,
    }));

  // Revision Triage: deliverables with many open (unresolved) timestamped notes.
  const comments = await ctx.db.query("revisionComments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const openByDeliverable = new Map<string, typeof comments>();
  for (const c of comments) {
    if (c.resolved) continue;
    const list = openByDeliverable.get(c.deliverableId) ?? [];
    list.push(c);
    openByDeliverable.set(c.deliverableId, list);
  }
  const revisionTriage: RevisionTriageSignal[] = [];
  for (const [deliverableId, list] of openByDeliverable) {
    if (list.length < REVISION_MIN_OPEN) continue;
    const deliverable = await ctx.db.get(deliverableId as Id<"deliverables">);
    if (!deliverable || deliverable.orgId !== orgId) continue;
    const song = songById.get(deliverable.songId);
    revisionTriage.push({
      id: deliverable.songId,
      title: song?.title ?? "Untitled",
      deliverableId: deliverable._id,
      deliverableLabel: deliverable.label,
      openComments: list
        .sort((a, b) => a.timestampSec - b.timestampSec)
        .slice(0, 30)
        .map((c) => ({ timestampSec: c.timestampSec, body: c.body, authorName: c.authorName })),
    });
    if (revisionTriage.length >= 10) break;
  }

  // Revenue Ops: complete_rights_metadata - songs near release missing ISRC/ISWC or an executed split sheet.
  const RIGHTS_NEAR = new Set(["mastering", "delivered", "released"]);
  const rightsMetadataGaps = songs
    .filter((song) => RIGHTS_NEAR.has(song.stage))
    .map((song) => {
      const missing: string[] = [];
      if (!song.isrc) missing.push("ISRC");
      if (!song.iswc) missing.push("ISWC");
      if (sheetBySong.get(song._id)?.status !== "fully_executed") missing.push("an executed split sheet");
      return { id: song._id, title: song.title, missing };
    })
    .filter((g) => g.missing.length > 0)
    .slice(0, 10);

  // Revenue Ops: pricing_opportunity - rooms running hot over the last 8 weeks.
  const pricingWindowStart = now - PRICING_WINDOW;
  const bookedHoursByRoom = new Map<string, number>();
  for (const sess of sessions) {
    if (!sess.roomId) continue;
    if (sess.status === "cancelled" || sess.status === "no_show") continue;
    if (sess.startTime < pricingWindowStart || sess.startTime > now) continue;
    const hours = (sess.endTime - sess.startTime) / 3_600_000;
    bookedHoursByRoom.set(sess.roomId, (bookedHoursByRoom.get(sess.roomId) ?? 0) + hours);
  }
  const pricingRooms: PricingOppSignal[] = rooms
    .filter((r) => r.bookable !== false && r.status !== "retired" && (r.hourlyRateCents ?? 0) > 0)
    .map((r) => ({
      id: r._id,
      name: r.name,
      hourlyRateCents: r.hourlyRateCents ?? 0,
      utilizationPct: Math.round(((bookedHoursByRoom.get(r._id) ?? 0) / PRICING_BOOKABLE_HOURS) * 100),
    }))
    .slice(0, 10);

  // Revenue Ops: no_show_risk - upcoming sessions with a flagged artist or unpaid deposit.
  const noShowRisks: NoShowRiskSignal[] = sessions
    .filter((sess) => (sess.status === "confirmed" || sess.status === "tentative") && sess.startTime > now && sess.startTime <= now + NOSHOW_HORIZON)
    .slice(0, 10)
    .map((sess) => {
      const artist = artistMap.get(sess.artistId);
      return {
        id: sess._id,
        title: sess.title,
        startTime: sess.startTime,
        artistName: artist?.name ?? "the artist",
        artistEmail: artist?.email,
        reliability: artist?.reliability ?? "solid",
        depositPaid: sess.depositPaid,
      };
    });

  // Revenue Ops: weak_lead_source - sources with poor lead->booking conversion.
  const leadCountBySource = new Map<string, number>();
  const bookedCountBySource = new Map<string, number>();
  for (const a of artists) {
    const src = a.source;
    if (!src) continue;
    leadCountBySource.set(src, (leadCountBySource.get(src) ?? 0) + 1);
    if (sessionsByArtist.has(a._id)) bookedCountBySource.set(src, (bookedCountBySource.get(src) ?? 0) + 1);
  }
  const weakLeadSources: WeakLeadSourceSignal[] = Array.from(leadCountBySource.entries())
    .map(([source, leadCount]) => ({ source, leadCount, bookedCount: bookedCountBySource.get(source) ?? 0 }))
    .slice(0, 10);

  return {
    now,
    orgName,
    quietArtists,
    overdueInvoices,
    unconfirmedSessions,
    depositUnpaid,
    revisionOverflow,
    splitSheetChase,
    underusedRooms,
    newLeads,
    upcomingPrep,
    recentlyCompleted,
    revisionTriage,
    rightsMetadataGaps,
    pricingRooms,
    noShowRisks,
    weakLeadSources,
  };
}

/** Action types whose draft body OpenAI rewrites after the rule layer
 * seeds a fallback. The deterministic body is always present first so
 * nothing breaks without an API key. */
const ENRICHABLE = new Set<ActionType>([
  "convert_lead",
  "session_prep_packet",
  "post_session_recap",
  "revision_triage",
  "payment_reminder",
  "reengage_quiet_artist",
  "chase_split_sheet",
  "complete_rights_metadata",
  "no_show_risk",
]);

/** Upsert candidate actions with open-row dedupe + Phase-3 autonomy. */
export async function upsertProposed(ctx: MutationCtx, orgId: string, candidates: ProposedAction[]): Promise<{ inserted: number; autoExecuted: number; enrichIds: Id<"opsActions">[] }> {
  const now = Date.now();
  const todayStart = now - (now % DAY);

  // Per-org auto-executes already done today (bounds runaway sends).
  const todays = await ctx.db.query("opsActions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  let autoToday = todays.filter((r) => r.autonomy && r.createdAt >= todayStart).length;

  const OPEN = new Set(["proposed", "approved", "snoozed", "executing"]);
  let inserted = 0;
  let autoExecuted = 0;
  const enrichIds: Id<"opsActions">[] = [];

  for (const c of candidates) {
    const dedupeKey = `${c.type}:${c.entityId ?? "org"}`;
    const existing = await ctx.db
      .query("opsActions")
      .withIndex("by_org_dedupe", (q) => q.eq("orgId", orgId).eq("dedupeKey", dedupeKey))
      .collect();
    if (existing.some((r) => OPEN.has(r.status))) continue;

    const policy = await ctx.db
      .query("opsAutonomy")
      .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("actionType", c.type))
      .first();
    const auto = policy?.mode === "auto" && autoToday < DAILY_AUTO_CAP;

    const id = await ctx.db.insert("opsActions", {
      orgId,
      type: c.type,
      priority: c.priority,
      title: c.title,
      rationale: c.rationale,
      entityType: c.entityType,
      entityId: c.entityId,
      payload: c.payload,
      status: auto ? "approved" : "proposed",
      autonomy: auto,
      source: "rule",
      dedupeKey,
      createdAt: now,
      ...(auto ? { decidedAt: now, decidedBy: "autopilot" } : {}),
    });
    inserted++;
    // Non-auto rows of an enrichable type get an OpenAI-written body before
    // a human ever sees them. Auto rows skip enrichment to avoid sending a
    // half-written body before the action fires.
    if (!auto && ENRICHABLE.has(c.type)) enrichIds.push(id);

    if (auto) {
      autoToday++;
      autoExecuted++;
      await ctx.scheduler.runAfter(0, internal.opsActions.execute, { id });
    }
  }

  return { inserted, autoExecuted, enrichIds };
}

/** Scan one org: gather -> candidates -> upsert -> schedule LLM enrichment. */
export const scanOrg = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const signals = await gatherSignals(ctx, orgId);
    const candidates = candidatesFor(signals);
    const res = await upsertProposed(ctx, orgId, candidates);
    if (res.enrichIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.aiActions.enrichOpsActions, { ids: res.enrichIds });
    }
    return { inserted: res.inserted, autoExecuted: res.autoExecuted };
  },
});

/** Active subaccount ids, excluding the seeded demo org. */
async function activeOrgIds(ctx: MutationCtx): Promise<string[]> {
  const orgs = await ctx.db.query("orgs").collect();
  return orgs
    .filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo")
    .map((o) => o.orgId);
}

/** Fan the scan across every active subaccount (cron entry point). */
export const scanAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await activeOrgIds(ctx);
    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.opsBrain.scanOrg, { orgId });
    }
    return { scheduled: ids.length };
  },
});

/** Fan the named-agent scan across every active subaccount. Shares scanOrg
 * (dedupe-safe), so the time-sensitive agents - booking conversion, session
 * prep, post-session recap, no-show risk - can run on a tighter cadence than
 * the daily ops-brain sweep without producing duplicate actions. */
export const scanAgentsAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ids = await activeOrgIds(ctx);
    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.opsBrain.scanOrg, { orgId });
    }
    return { scheduled: ids.length };
  },
});
