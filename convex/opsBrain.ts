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

const DAY = 86_400_000;
const QUIET_DAYS = 90;
const CONFIRM_HORIZON = 3 * DAY;
const UPCOMING_WINDOW = 7 * DAY;
const DAILY_AUTO_CAP = 20;

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
  | "deposit_unpaid_nudge";

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
            body: `Hi ${firstName(inv.artistName)}, just a quick nudge that invoice ${inv.number} for ${fmtCents(inv.amountCents)} is now past due. You can settle it any time - reply here if you need a hand.`,
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

  return { now, orgName, quietArtists, overdueInvoices, unconfirmedSessions, depositUnpaid, revisionOverflow, splitSheetChase, underusedRooms };
}

/** Upsert candidate actions with open-row dedupe + Phase-3 autonomy. */
export async function upsertProposed(ctx: MutationCtx, orgId: string, candidates: ProposedAction[]): Promise<{ inserted: number; autoExecuted: number }> {
  const now = Date.now();
  const todayStart = now - (now % DAY);

  // Per-org auto-executes already done today (bounds runaway sends).
  const todays = await ctx.db.query("opsActions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  let autoToday = todays.filter((r) => r.autonomy && r.createdAt >= todayStart).length;

  const OPEN = new Set(["proposed", "approved", "snoozed", "executing"]);
  let inserted = 0;
  let autoExecuted = 0;

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

    if (auto) {
      autoToday++;
      autoExecuted++;
      await ctx.scheduler.runAfter(0, internal.opsActions.execute, { id });
    }
  }

  return { inserted, autoExecuted };
}

/** Scan one org: gather -> candidates -> upsert. */
export const scanOrg = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const signals = await gatherSignals(ctx, orgId);
    const candidates = candidatesFor(signals);
    return upsertProposed(ctx, orgId, candidates);
  },
});

/** Fan the scan across every active subaccount (cron entry point). */
export const scanAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const ids = orgs
      .filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo")
      .map((o) => o.orgId);
    for (const orgId of ids) {
      await ctx.scheduler.runAfter(0, internal.opsBrain.scanOrg, { orgId });
    }
    return { scheduled: ids.length };
  },
});
