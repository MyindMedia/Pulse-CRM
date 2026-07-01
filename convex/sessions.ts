import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg, currentOrgWithCapability} from "./lib/tenant";
import {
  assertNoBufferConflict,
  recomputeRoomStatus,
} from "./lib/roomStatus";
import { money } from "./lib/money";
import { stageChecklistsFor, dropPreChecklistFor } from "./checklists";
import { ensureSessionShift } from "./shifts";
import { proposeWaitlistFill } from "./waitlist";
import { scheduleGoogleCalendarPush, scheduleGoogleCalendarRemove } from "./googleCalendar";
import { api } from "./_generated/api";

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);
const statusV = v.union(
  v.literal("tentative"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("no_show"),
);

/** Hydrate a session with its artist / song / room / engineer names. */
async function hydrate(ctx: QueryCtx, s: Doc<"sessions">) {
  const [artist, song, room, engineer] = await Promise.all([
    s.artistId ? ctx.db.get(s.artistId) : null,
    s.songId ? ctx.db.get(s.songId) : null,
    s.roomId ? ctx.db.get(s.roomId) : null,
    s.engineerId ? ctx.db.get(s.engineerId) : null,
  ]);
  return {
    ...s,
    artistName: artist?.name ?? "Unknown",
    songTitle: song?.title ?? null,
    roomName: room?.name ?? null,
    engineerName: engineer?.name ?? null,
  };
}

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const orgId = await currentOrg(ctx);
    const rows = status
      ? await ctx.db.query("sessions").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status)).collect()
      : await ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const hydrated = await Promise.all(rows.map((r) => hydrate(ctx, r)));
    return hydrated.sort((a, b) => a.startTime - b.startTime);
  },
});

export const inRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from).lte("startTime", to))
      .collect();
    return Promise.all(rows.map((r) => hydrate(ctx, r)));
  },
});

export const upcoming = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now))
      .take(limit ?? 8);
    return Promise.all(rows.map((r) => hydrate(ctx, r)));
  },
});

export const get = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) return null;
    const log = await ctx.db.query("engineeringLogs").withIndex("by_session", (q) => q.eq("sessionId", id)).first();
    return { ...(await hydrate(ctx, s)), engineeringLog: log };
  },
});

/**
 * Shared session-creation helper. Inserts a tentative session, logs the
 * activity, stages checklists and recomputes the room status. Both the
 * internal `create` mutation and `opportunities.convertToBooking` route
 * through here so the hold/deposit behaviour stays identical everywhere.
 */
export async function insertSession(
  ctx: MutationCtx,
  args: {
    orgId: string;
    title: string;
    artistId: Id<"artists">;
    artistName: string;
    songId?: Id<"songs">;
    serviceType: Doc<"sessions">["serviceType"];
    roomId?: Id<"rooms">;
    engineerId?: Id<"members">;
    startTime: number;
    endTime: number;
    rateCents: number;
    depositCents?: number;
  },
): Promise<Id<"sessions">> {
  // 15-minute reset buffer between sessions in the same room.
  await assertNoBufferConflict(ctx, args.roomId, args.startTime, args.endTime);

  // Smart-deposit shield: a session is only tentative until the deposit clears.
  const deposit = args.depositCents ?? Math.round(args.rateCents * 0.3);
  const id = await ctx.db.insert("sessions", {
    orgId: args.orgId,
    title: args.title,
    artistId: args.artistId,
    songId: args.songId,
    serviceType: args.serviceType,
    roomId: args.roomId,
    engineerId: args.engineerId,
    startTime: args.startTime,
    endTime: args.endTime,
    status: "tentative",
    rateCents: args.rateCents,
    depositCents: deposit,
    depositPaid: false,
    intakeCompleted: false,
  });
  await ctx.db.insert("activity", {
    orgId: args.orgId,
    kind: "session.created",
    summary: `${args.title} held for ${args.artistName} - awaiting deposit`,
    entityType: "session",
    entityId: id,
    accent: "info",
  });
  // Stage the pre + post checklists so engineers and interns can tick
  // through them before / after the session.
  await stageChecklistsFor(ctx, {
    orgId: args.orgId,
    sessionId: id,
    roomId: args.roomId,
  });
  // Auto-recompute the room's status so the dashboard reflects the change.
  if (args.roomId) await recomputeRoomStatus(ctx, args.roomId);
  return id;
}

export const create = mutation({
  args: {
    title: v.string(),
    // Either an existing artist OR a brand-new client (name + optional contact).
    artistId: v.optional(v.id("artists")),
    clientName: v.optional(v.string()),
    clientEmail: v.optional(v.string()),
    clientPhone: v.optional(v.string()),
    songId: v.optional(v.id("songs")),
    serviceType: serviceV,
    roomId: v.optional(v.id("rooms")),
    engineerId: v.optional(v.id("members")),
    startTime: v.number(),
    endTime: v.number(),
    rateCents: v.number(),
    depositCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);

    // Resolve the booker: an existing artist, or create a new "lead" client
    // on the fly from a typed name so walk-in / first-time bookers work too.
    let artistId = args.artistId;
    let artistName: string;
    if (artistId) {
      const artist = await ctx.db.get(artistId);
      if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
      artistName = artist.name;
    } else {
      const name = args.clientName?.trim();
      if (!name) throw new Error("A client name (or existing artist) is required");
      artistId = await ctx.db.insert("artists", {
        orgId,
        name,
        type: "artist",
        email: args.clientEmail?.trim() || undefined,
        phone: args.clientPhone?.trim() || undefined,
        genres: [],
        tags: [],
        status: "lead",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        source: "booking",
      });
      artistName = name;
    }

    const sessionId = await insertSession(ctx, {
      orgId,
      title: args.title,
      artistId,
      artistName,
      songId: args.songId,
      serviceType: args.serviceType,
      roomId: args.roomId,
      engineerId: args.engineerId,
      startTime: args.startTime,
      endTime: args.endTime,
      rateCents: args.rateCents,
      depositCents: args.depositCents,
    });

    // Staff scheduling: auto-create the engineer's shift for this session and
    // surface a soft warning if they're double-booked (never blocks).
    const { warning } = await ensureSessionShift(ctx, {
      _id: sessionId,
      orgId,
      engineerId: args.engineerId ?? null,
      roomId: args.roomId ?? null,
      startTime: args.startTime,
      endTime: args.endTime,
    });

    // Two-way calendar: mirror the new session onto the studio's Google
    // primary calendar (silent no-op when not connected).
    await scheduleGoogleCalendarPush(ctx, sessionId);

    return { sessionId, staffingWarning: warning };
  },
});

/** Assign (or clear) the engineer on a session; keeps the auto-shift in sync and
 *  returns a soft warning if the engineer is double-booked. */
export const assignEngineer = mutation({
  args: { sessionId: v.id("sessions"), engineerId: v.optional(v.id("members")) },
  handler: async (ctx, { sessionId, engineerId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new Error("Session not found");
    if (engineerId) {
      const eng = await ctx.db.get(engineerId);
      if (!eng || eng.orgId !== orgId) throw new Error("Engineer not found");
    }
    await ctx.db.patch(sessionId, { engineerId });
    const { warning } = await ensureSessionShift(ctx, {
      _id: sessionId,
      orgId,
      engineerId: engineerId ?? null,
      roomId: session.roomId ?? null,
      startTime: session.startTime,
      endTime: session.endTime,
    });
    return { staffingWarning: warning };
  },
});

/** Comp or discount a session, tracking the foregone revenue. `listValueCents`
 *  is what it would normally bill (defaults to the current rate the first time);
 *  comped sets the rate to 0, discounted sets it to `chargedCents`. "none"
 *  un-comps and restores the list value as the rate. */
export const setComp = mutation({
  args: {
    id: v.id("sessions"),
    compType: v.union(v.literal("comped"), v.literal("discounted"), v.literal("none")),
    listValueCents: v.optional(v.number()),
    chargedCents: v.optional(v.number()),
    compReason: v.optional(v.string()),
  },
  handler: async (ctx, { id, compType, listValueCents, chargedCents, compReason }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");

    if (compType === "none") {
      const restored = s.listValueCents ?? s.rateCents;
      await ctx.db.patch(id, {
        compType: undefined,
        listValueCents: undefined,
        compReason: undefined,
        rateCents: restored,
      });
      await ctx.db.insert("activity", {
        orgId,
        kind: "session.comp.cleared",
        summary: `Comp removed from "${s.title}"`,
        entityType: "session",
        entityId: id,
        accent: "info",
      });
      return;
    }

    // The first time you comp, the standing rate IS the list value.
    const list = listValueCents ?? s.listValueCents ?? s.rateCents;
    const charged = compType === "comped" ? 0 : Math.max(0, Math.round(chargedCents ?? 0));
    if (compType === "discounted" && charged >= list) {
      throw new Error("A discount must be below the list value.");
    }
    const foregone = Math.max(0, list - charged);
    await ctx.db.patch(id, {
      compType,
      listValueCents: list,
      compReason: compReason?.trim() || undefined,
      rateCents: charged,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.comp.set",
      summary: `${compType === "comped" ? "Comped" : "Discounted"} "${s.title}" - ${money(foregone)} foregone${compReason ? `, ${compReason.trim()}` : ""}`,
      entityType: "session",
      entityId: id,
      accent: "caution",
    });
    return { foregoneCents: foregone };
  },
});

export const payDeposit = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    // Ledger first: a manually-recorded deposit lands as a real payments row
    // so the money reconciles everywhere (checkout page, P&L, completion
    // invoice). Skip when a cleared deposit/full row already exists for this
    // session so a re-click can never double-insert.
    const ledger = await ctx.db
      .query("payments")
      .withIndex("by_session", (q) => q.eq("sessionId", id))
      .collect();
    const alreadyLedgered = ledger.some(
      (p) => (p.kind === "deposit" || p.kind === "full") && p.status === "paid",
    );
    const patch: Record<string, unknown> = { depositPaid: true, status: "confirmed" };
    if (!alreadyLedgered && !s.depositPaid && s.depositCents > 0) {
      await ctx.db.insert("payments", {
        orgId,
        sessionId: id,
        kind: "deposit",
        amountCents: s.depositCents,
        provider: "simulated", // manually recorded by staff (cash / card reader)
        status: "paid",
        reference: `MANUAL-${String(Date.now()).slice(-8)}`,
        paidAt: Date.now(),
      });
      patch.amountPaidCents = (s.amountPaidCents ?? 0) + s.depositCents;
    }
    await ctx.db.patch(id, patch);
    if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.confirmed",
      summary: `Deposit cleared - ${s.title} is confirmed on the calendar`,
      entityType: "session",
      entityId: id,
      accent: "positive",
    });
    // Surface a pre-session checklist alert via the existing insights bell.
    await ctx.db.insert("insights", {
      orgId,
      kind: "recap",
      severity: "info",
      title: `Pre-session checklist ready - ${s.title}`,
      body: `Confirmed for ${longDateLite(s.startTime)}. Walk the pre-session checklist before the artist arrives.`,
      entityType: "session",
      entityId: id,
      status: "new",
    });
    // Schedule no-show prevention reminders + 1h prep packet.
    const now = Date.now();
    const reminder24At = s.startTime - TWENTY_FOUR_HOURS_MS;
    const reminder1At = s.startTime - ONE_HOUR_MS;
    const prepAt = s.startTime - ONE_HOUR_MS;
    if (reminder24At > now) {
      await ctx.scheduler.runAt(reminder24At, api.aiActions.generateReminder24h, { sessionId: id });
    }
    if (reminder1At > now) {
      await ctx.scheduler.runAt(reminder1At, api.aiActions.generateReminder1h, { sessionId: id });
    }
    if (prepAt > now) {
      await ctx.scheduler.runAt(prepAt, api.aiActions.generatePrepPacket, { sessionId: id });
    }
  },
});

/**
 * Invoice whatever is still owed when a session completes. Shared by the
 * manual setStatus("completed") path below and the automation cron's
 * auto-complete (automation.ts) so both paths bill identically. Credits every
 * cleared payment (amountPaidCents, plus the legacy depositPaid flag for rows
 * that predate the payments ledger) so a session can never be over-billed,
 * skips entirely when nothing is owed, and never double-invoices a session
 * that already has a live invoice.
 */
export async function createCompletionInvoice(
  ctx: MutationCtx,
  s: Doc<"sessions">,
): Promise<Id<"invoices"> | null> {
  // max() not sum: deposits settled through the ledger set BOTH
  // amountPaidCents and depositPaid, so adding them would double-credit.
  const paidCents = Math.max(s.amountPaidCents ?? 0, s.depositPaid ? s.depositCents : 0);
  const balance = Math.max(0, s.rateCents - paidCents);
  if (balance <= 0) return null;
  const existing = await ctx.db
    .query("invoices")
    .withIndex("by_artist", (q) => q.eq("artistId", s.artistId))
    .collect();
  if (existing.some((inv) => inv.sessionId === s._id && inv.status !== "void")) return null;
  const num = `PLS-${String(Date.now()).slice(-6)}`;
  return ctx.db.insert("invoices", {
    orgId: s.orgId,
    number: num,
    artistId: s.artistId,
    songId: s.songId,
    sessionId: s._id,
    status: "draft",
    lineItems: [{ label: `${s.title} - balance`, amountCents: balance }],
    amountCents: balance,
    dueDate: Date.now() + 14 * 86400000,
  });
}

/** Local one-liner to avoid importing the whole format lib server-side. */
function longDateLite(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const setStatus = mutation({
  args: { id: v.id("sessions"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status });
    // Status change cascades to the room: cancelling an active session
    // flips the room back to available; starting one flips it to in_use.
    if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);

    // Cancelled / no-show before-it-ran -> drop the unused pre-checklist
    // so we don't keep alerting staff for a session that won't happen.
    if (status === "cancelled" || status === "no_show") {
      await dropPreChecklistFor(ctx, id);
    }

    // A freshly cancelled future slot is a smart-fill opportunity: offer it to
    // the best-matched waitlisted artist (proposed into the approval inbox).
    if (status === "cancelled" && s.status !== "cancelled") {
      await proposeWaitlistFill(ctx, s);
    }

    // Two-way calendar: cancellations pull the Google event; any other status
    // change is mirrored as a patch (so Google reflects the new state).
    if (status === "cancelled" && s.status !== "cancelled") {
      await scheduleGoogleCalendarRemove(ctx, id);
    } else if (status !== s.status) {
      await scheduleGoogleCalendarPush(ctx, id);
    }

    if (status === "no_show") {
      const artist = await ctx.db.get(s.artistId);
      if (artist) await ctx.db.patch(s.artistId, { reliability: "watch" });
      await ctx.db.insert("activity", {
        orgId, kind: "session.no_show",
        summary: `No-show flagged - ${artist?.name ?? "client"} marked for review`,
        entityType: "session", entityId: id, accent: "critical",
      });
    }

    // Session completed → fan out: invoice the balance + queue a recap insight.
    if (status === "completed") {
      const artist = await ctx.db.get(s.artistId);
      await ctx.db.patch(s.artistId, {
        sessionCount: (artist?.sessionCount ?? 0) + 1,
        lifetimeValueCents: (artist?.lifetimeValueCents ?? 0) + s.rateCents,
        lastContactAt: Date.now(),
        status: artist?.status === "lead" ? "active" : artist?.status,
      });
      const invoiceId = await createCompletionInvoice(ctx, s);
      await ctx.db.insert("insights", {
        orgId, kind: "recap", severity: "info",
        title: `Post-session checklist + recap - ${s.title}`,
        body: `Session complete. Walk the post-session checklist (clean / reset / lock the room) and log the engineering recall sheet for ${artist?.name ?? "the client"}.`,
        entityType: "session", entityId: id, status: "new",
      });
      // Kick the recap generator immediately so the artist email is ready
      // by the time the engineer closes out the recall sheet.
      await ctx.scheduler.runAfter(0, api.aiActions.generateSessionRecap, {
        sessionId: id,
      });
      await ctx.db.insert("activity", {
        orgId, kind: "session.completed",
        summary: `${s.title} completed${invoiceId ? " - balance invoiced automatically" : " - paid in full, nothing left to invoice"}`,
        entityType: "session", entityId: id, accent: "positive",
      });
    }
  },
});

export const completeIntake = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { intakeCompleted: true });
  },
});
