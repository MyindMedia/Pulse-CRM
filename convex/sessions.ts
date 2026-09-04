import { query, QueryCtx, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { fireRules } from "./agentRules";
import { queuePayoutForSession } from "./payouts";
import { Doc, Id } from "./_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { currentOrg, currentOrgWithCapability} from "./lib/tenant";
import { resolveViewer } from "./lib/access";
import {
  assertNoBufferConflict,
  recomputeRoomStatus,
} from "./lib/roomStatus";
import {
  bookedUnits,
  gearAvailable,
  addOnsTotalCents,
} from "./lib/gearRental";
import { money } from "./lib/money";
import { notify } from "./lib/notify";
import { stageChecklistsFor, dropPreChecklistFor } from "./checklists";
import { ensureSessionShift } from "./shifts";
import { proposeWaitlistFill } from "./waitlist";
import { scheduleGoogleCalendarPush, scheduleGoogleCalendarRemove } from "./googleCalendar";
import { api, internal } from "./_generated/api";
import { normalizeEmail } from "./lib/emailKey";

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
  v.literal("custom"),   // label lives in customService
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
    customService?: string;
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
    customService: args.customService?.trim() || undefined,
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
    /** Required when serviceType is "custom" - the studio's own name for it. */
    customService: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    engineerId: v.optional(v.id("members")),
    startTime: v.number(),
    endTime: v.number(),
    rateCents: v.number(),
    depositCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);

    /* A custom category with no name is a row on the calendar nobody can read.
       The point of the category IS the label. */
    if (args.serviceType === "custom" && !args.customService?.trim()) {
      throw new ConvexError("Name the category - a custom booking needs one.");
    }

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
        email: normalizeEmail(args.clientEmail) || undefined,
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
      customService: args.customService,
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

/**
 * No-Show Shield: invoice the fee still owed after a forfeited deposit is
 * applied. Draft invoice, 14-day terms, idempotent - never adds a second fee
 * invoice for the same session (a re-run of the cancel/no-show path is a no-op).
 * Returns the new invoice id, or null when nothing was owed / one already exists.
 */
export async function createCancellationFeeInvoice(
  ctx: MutationCtx,
  s: Doc<"sessions">,
  amountCents: number,
  label: string,
): Promise<Id<"invoices"> | null> {
  if (amountCents <= 0) return null;
  const existing = await ctx.db
    .query("invoices")
    .withIndex("by_artist", (q) => q.eq("artistId", s.artistId))
    .collect();
  // One fee invoice per session: any live invoice already tagged as a fee for
  // this session blocks a duplicate.
  const alreadyBilled = existing.some(
    (inv) =>
      inv.sessionId === s._id &&
      inv.status !== "void" &&
      inv.lineItems.some((li) => li.label.toLowerCase().includes("fee")),
  );
  if (alreadyBilled) return null;
  const num = `PLS-${String(Date.now()).slice(-6)}`;
  return ctx.db.insert("invoices", {
    orgId: s.orgId,
    number: num,
    artistId: s.artistId,
    songId: s.songId,
    sessionId: s._id,
    status: "draft",
    lineItems: [{ label: `${s.title} - ${label}`, amountCents }],
    amountCents,
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

/**
 * Assess the No-Show Shield on a session that just moved to cancelled / no_show.
 * Reads the org's cancellation policy, forfeits any paid deposit, and bills the
 * remaining fee (an auto-charge when a card is on file, otherwise a fee invoice
 * plus a short professional notice email). Every recovered dollar is logged to
 * the recovery ledger so the "Recovered by Pulse" ticker reflects it.
 */
async function assessNoShowShield(
  ctx: MutationCtx,
  s: Doc<"sessions">,
  status: "cancelled" | "no_show",
): Promise<void> {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", s.orgId))
    .first();
  const feePct = Math.min(Math.max(org?.cancellationFeePct ?? 0, 0), 100);
  const windowMs = Math.max(org?.cancellationWindowHours ?? 0, 0) * ONE_HOUR_MS;
  const insideWindow = Date.now() >= s.startTime - windowMs;
  // A no-show always assesses; a cancel only inside the notice window (a cancel
  // outside the window is free - the existing behavior).
  const chargeable = status === "no_show" || insideWindow;
  if (!chargeable) return;

  const fee = Math.round((s.rateCents * feePct) / 100);
  const depositForfeitCents = s.depositPaid ? s.depositCents : 0;
  // The deposit already in hand is applied toward the fee; only the remainder
  // needs collecting.
  const additionalCents = Math.max(0, fee - depositForfeitCents);

  await ctx.db.patch(s._id, {
    cancellationFeeCents: fee,
    depositForfeited: depositForfeitCents > 0,
  });

  const artist = await ctx.db.get(s.artistId);
  const feeKind = status === "no_show" ? "no_show_fee" : "cancellation_fee";
  const label = status === "no_show" ? "no-show fee" : "late cancellation fee";
  const reason = status === "no_show" ? "no-show" : "late cancellation";

  // The kept deposit is recovered money the moment it is forfeited.
  if (depositForfeitCents > 0) {
    await ctx.runMutation(internal.recovery.record, {
      orgId: s.orgId,
      kind: "deposit_forfeited",
      amountCents: depositForfeitCents,
      sessionId: s._id,
      note: `${s.title} - deposit forfeited on ${reason}`,
    });
  }

  if (additionalCents > 0) {
    // The shield always ships fully functional through invoices: bill the fee,
    // log the recovery, and notify the client.
    const invoiceId = await createCancellationFeeInvoice(ctx, s, additionalCents, label);
    await ctx.runMutation(internal.recovery.record, {
      orgId: s.orgId,
      kind: feeKind,
      amountCents: additionalCents,
      sessionId: s._id,
      invoiceId: invoiceId ?? undefined,
      note: `${s.title} - ${label}`,
    });

    // Best-effort auto-charge when a card is on file for this client on the
    // studio's connected Stripe account. Off-session charge runs in an action;
    // on success it settles the fee invoice. Falls back to the invoice + notice
    // above when no card is saved (the common case until card capture ships).
    const canAutoCharge =
      Boolean(process.env.STRIPE_SECRET_KEY) &&
      Boolean(org?.stripeAccountId) &&
      Boolean(org?.stripeChargesEnabled) &&
      Boolean(artist?.stripeCustomerId) &&
      Boolean(artist?.defaultPaymentMethodId);
    if (canAutoCharge && invoiceId) {
      await ctx.scheduler.runAfter(0, internal.cardOnFile.chargeFee, {
        sessionId: s._id,
        invoiceId,
        amountCents: additionalCents,
      });
    }

    if (artist?.email) {
      const nice = `${label[0].toUpperCase()}${label.slice(1)}`;
      const depositLine =
        depositForfeitCents > 0
          ? ` Your ${money(depositForfeitCents)} deposit has been applied toward it.`
          : "";
      await notify(ctx, {
        orgId: s.orgId,
        channel: "email",
        recipient: artist.email,
        subject: `${nice} - ${s.title}`,
        body: `Hi ${artist.name},\n\nPer our booking policy, a ${label} of ${money(
          fee,
        )} applies to your ${status === "no_show" ? "missed" : "late-cancelled"} session "${s.title}".${depositLine} We have sent an invoice for the ${money(
          additionalCents,
        )} balance. Reply here with any questions - we would love to get you rebooked.`,
        kind: `session.${feeKind}`,
        sessionId: s._id,
      });
    }
  }

  await ctx.db.insert("activity", {
    orgId: s.orgId,
    kind: `session.${status}.fee`,
    summary: `No-Show Shield: ${money(fee)} ${label} on ${s.title}${
      depositForfeitCents > 0 ? ` (${money(depositForfeitCents)} deposit kept)` : ""
    }`,
    entityType: "session",
    entityId: s._id,
    accent: "gold",
  });
}

export const setStatus = mutation({
  args: { id: v.id("sessions"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    // Snapshot BEFORE the patch: only a fresh transition out of an active state
    // into cancelled / no-show assesses the shield (so a re-set is idempotent).
    const wasActive = s.status !== "cancelled" && s.status !== "no_show";
    await ctx.db.patch(id, { status });
    // Status change cascades to the room: cancelling an active session
    // flips the room back to available; starting one flips it to in_use.
    if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);

    // Cancelled / no-show before-it-ran -> drop the unused pre-checklist
    // so we don't keep alerting staff for a session that won't happen.
    if (status === "cancelled" || status === "no_show") {
      await dropPreChecklistFor(ctx, id);
    }

    // A freshly freed slot (cancelled OR no-show) is a smart-fill opportunity:
    // offer it to the best-matched waitlisted artist (proposed into the approval
    // inbox). proposeWaitlistFill self-guards past/unfillable slots.
    if ((status === "cancelled" || status === "no_show") && wasActive) {
      await proposeWaitlistFill(ctx, s);
    }

    // ── No-Show Shield: a late cancel (inside the studio's cancellation window)
    // or a no-show forfeits any paid deposit and assesses the cancellation fee,
    // proving the subscription pays for itself. Only fires on a fresh transition.
    if ((status === "cancelled" || status === "no_show") && wasActive) {
      await assessNoShowShield(ctx, s, status);
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
      await fireRules(ctx, orgId, "session.no_show", {
        clientName: artist?.name,
        entityType: "session",
        entityId: id,
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
      // The engineer's cut, worked out now while the numbers are in front of
      // us rather than in someone's head at the end of the month. Queues only;
      // paying it out is still a decision a person makes.
      await queuePayoutForSession(ctx, { ...s, status: "completed" });
      // Standing rules the owner promoted from an insight, fired on the real
      // event rather than discovered by polling for it.
      await fireRules(ctx, orgId, "session.completed", {
        clientName: artist?.name,
        entityType: "session",
        entityId: id,
      });
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

/* ============================================================
   Mid-session / turnover floor actions - the things operators need
   once a session is on the calendar: extend or reschedule the window,
   add gear on the fly, and rebook. All gated to `sessions.edit`.
   ============================================================ */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rescale a by-duration rate when a session's window length changes. The
 * effective hourly rate is derived from the SESSION itself (rate minus any
 * gear add-ons, over the current hours) so room-rate and custom-priced
 * sessions both scale correctly. Comp / discount proportionality is preserved
 * by scaling the list value the same way and holding the charged/list ratio
 * constant. Deposit and amountPaid are never touched here - the overtime lands
 * on the outstanding balance through the normal completion-invoice flow.
 * Returns null when the duration is unchanged (or degenerate).
 */
function recomputeDurationRate(
  s: Doc<"sessions">,
  newStart: number,
  newEnd: number,
): { rateCents: number; listValueCents?: number } | null {
  const oldMs = s.endTime - s.startTime;
  const newMs = newEnd - newStart;
  if (oldMs <= 0 || newMs === oldMs) return null;
  const addOnTotal = addOnsTotalCents(s.addOns ?? []);
  const scale = newMs / oldMs;
  if (s.listValueCents && s.listValueCents > 0) {
    const listRoom = Math.max(0, s.listValueCents - addOnTotal);
    const newListValue = Math.round(listRoom * scale) + addOnTotal;
    const ratio = s.rateCents / s.listValueCents;
    return { rateCents: Math.round(newListValue * ratio), listValueCents: newListValue };
  }
  const room = Math.max(0, s.rateCents - addOnTotal);
  return { rateCents: Math.round(room * scale) + addOnTotal };
}

/**
 * Shared reschedule engine: conflict-check the new window against other live
 * sessions in the same room (15-minute reset buffer, self excluded), recompute
 * the by-duration rate, keep the engineer shift + room status + Google mirror
 * in sync, and log the change. Both `reschedule` and `extend` route through it.
 */
async function applyReschedule(
  ctx: MutationCtx,
  orgId: string,
  s: Doc<"sessions">,
  startTime: number,
  endTime: number,
): Promise<{ rateCents: number; startTime: number; endTime: number }> {
  if (endTime <= startTime) throw new Error("The session must end after it starts.");
  await assertNoBufferConflict(ctx, s.roomId, startTime, endTime, s._id);

  const rate = recomputeDurationRate(s, startTime, endTime);
  const patch: Record<string, unknown> = { startTime, endTime };
  if (rate) {
    patch.rateCents = rate.rateCents;
    if (rate.listValueCents !== undefined) patch.listValueCents = rate.listValueCents;
  }
  await ctx.db.patch(s._id, patch);

  // Keep the engineer's auto-shift aligned with the new window (soft warning
  // only, never blocks), then refresh room status + the Google mirror.
  await ensureSessionShift(ctx, {
    _id: s._id,
    orgId,
    engineerId: s.engineerId ?? null,
    roomId: s.roomId ?? null,
    startTime,
    endTime,
  });
  if (s.roomId) await recomputeRoomStatus(ctx, s.roomId);
  await scheduleGoogleCalendarPush(ctx, s._id);

  const deltaMins = Math.round((endTime - startTime - (s.endTime - s.startTime)) / 60_000);
  const newRate = rate?.rateCents ?? s.rateCents;
  const summary =
    deltaMins !== 0
      ? `${s.title} ${deltaMins > 0 ? "extended" : "shortened"} by ${Math.abs(deltaMins)} min${
          rate ? ` - rate now ${money(newRate)}` : ""
        }`
      : `${s.title} moved to ${longDateLite(startTime)}`;
  await ctx.db.insert("activity", {
    orgId,
    kind: "session.rescheduled",
    summary,
    entityType: "session",
    entityId: s._id,
    accent: "info",
  });
  return { rateCents: newRate, startTime, endTime };
}

/** Move a session to a new window (drag-to-reschedule / manual edit). Gated
 *  `sessions.edit`; conflict-checked; recomputes the by-duration rate. */
export const reschedule = mutation({
  args: { id: v.id("sessions"), startTime: v.number(), endTime: v.number() },
  handler: async (ctx, { id, startTime, endTime }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    return applyReschedule(ctx, orgId, s, startTime, endTime);
  },
});

/** Extend (or trim, with a negative value) a session's end time by N minutes -
 *  the mid-session overtime button. Gated `sessions.edit`; overtime becomes
 *  billable through the recomputed rate + normal balance flow. */
export const extend = mutation({
  args: { id: v.id("sessions"), addMinutes: v.number() },
  handler: async (
    ctx,
    { id, addMinutes },
  ): Promise<{ rateCents: number; startTime: number; endTime: number }> => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    const mins = Math.round(addMinutes);
    if (mins === 0) throw new Error("Pick how long to extend the session.");
    const endTime = s.endTime + mins * 60_000;
    return applyReschedule(ctx, orgId, s, s.startTime, endTime);
  },
});

/** Rentable gear that can still be added to this session's window, each priced
 *  and conflict-checked so a single unit already committed to an overlapping
 *  session shows as unavailable. Drives the "Add gear" control in the sheet. */
export const gearOptions = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) return [];
    const around = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", s.startTime - DAY_MS).lt("startTime", s.endTime),
      )
      .collect();
    const already = new Set((s.addOns ?? []).map((a) => a.equipmentId));
    const equip = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return equip
      .filter((e) => e.rentable)
      .map((e) => {
        const booked = bookedUnits(e._id, s.startTime, s.endTime, around, s._id);
        return {
          id: e._id,
          name: e.name,
          category: e.category,
          priceCents: e.rentalPriceCents ?? 0,
          alreadyOn: already.has(e._id),
          available: !already.has(e._id) && gearAvailable(e, booked),
        };
      })
      .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name));
  },
});

/** Append a gear add-on to an existing session and fold its rental price into
 *  the rate. Gated `sessions.edit`; conflict-checks single-unit gear against
 *  overlapping sessions (same rule as the public booking add-ons). */
export const addGear = mutation({
  args: { id: v.id("sessions"), equipmentId: v.id("equipment") },
  handler: async (ctx, { id, equipmentId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    const item = await ctx.db.get(equipmentId);
    if (!item || item.orgId !== orgId || !item.rentable) {
      throw new Error("That gear isn't available to rent.");
    }
    if ((s.addOns ?? []).some((a) => a.equipmentId === equipmentId)) {
      throw new Error(`${item.name} is already on this session.`);
    }
    const around = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", s.startTime - DAY_MS).lt("startTime", s.endTime),
      )
      .collect();
    const booked = bookedUnits(item._id, s.startTime, s.endTime, around, s._id);
    if (!gearAvailable(item, booked)) {
      throw new Error(`${item.name} is booked on another overlapping session.`);
    }
    const priceCents = item.rentalPriceCents ?? 0;
    const addOns = [...(s.addOns ?? []), { equipmentId: item._id, name: item.name, priceCents }];
    const patch: Record<string, unknown> = { addOns, rateCents: s.rateCents + priceCents };
    // The rental is billed at full price even on a comped / discounted session,
    // so fold it into the list value too - that keeps foregone (list - charged)
    // unchanged rather than silently comping the gear.
    if (s.listValueCents && s.listValueCents > 0) {
      patch.listValueCents = s.listValueCents + priceCents;
    }
    await ctx.db.patch(id, patch);
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.gear.added",
      summary: `${item.name} added to "${s.title}" (+${money(priceCents)})`,
      entityType: "session",
      entityId: id,
      accent: "info",
    });
    return { rateCents: s.rateCents + priceCents, addOnTotalCents: addOnsTotalCents(addOns) };
  },
});

/* ============================================================
   No-Show Shield: cancellation policy + on-the-spot balance
   collection. The policy setter lives here (not orgs.ts) but only
   patches the org row; reading org cross-table is fine.
   ============================================================ */

/** The studio's cancellation policy (window + fee %). Null when unset. */
export const getCancellationPolicy = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      cancellationWindowHours: org?.cancellationWindowHours ?? null,
      cancellationFeePct: org?.cancellationFeePct ?? null,
    };
  },
});

/** Set the cancellation window (hours) and fee (% of the booking rate). Gated to
 *  leadership (branding.edit). Patches the org row only. */
export const setCancellationPolicy = mutation({
  args: {
    cancellationWindowHours: v.optional(v.number()),
    cancellationFeePct: v.optional(v.number()),
  },
  handler: async (ctx, { cancellationWindowHours, cancellationFeePct }) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("No workspace to configure.");
    const patch: Record<string, number> = {};
    if (cancellationWindowHours !== undefined) {
      patch.cancellationWindowHours = Math.max(0, Math.round(cancellationWindowHours));
    }
    if (cancellationFeePct !== undefined) {
      patch.cancellationFeePct = Math.min(100, Math.max(0, Math.round(cancellationFeePct)));
    }
    await ctx.db.patch(org._id, patch);
    return { ok: true };
  },
});

/** The public pay link + outstanding balance for a session, for the studio to
 *  hand off (QR / copy / text). Scoped to the caller's own org. */
export const payLink = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) return null;
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const artist = await ctx.db.get(s.artistId);
    const base =
      process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const slug = org?.slug ?? "";
    const url = slug ? `${base}/book/${slug}/checkout/${id}` : null;
    const paid = s.amountPaidCents ?? 0;
    return {
      url,
      balanceCents: Math.max(0, s.rateCents - paid),
      hasPhone: Boolean(artist?.phone),
    };
  },
});

/** Text the public pay link to the client. Gated (sessions.edit); needs a phone
 *  on file. Reuses the notify() SMS seam. */
export const sendPayLinkSms = mutation({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const s = await ctx.db.get(id);
    if (!s || s.orgId !== orgId) throw new Error("Not found");
    const artist = await ctx.db.get(s.artistId);
    if (!artist?.phone) throw new Error("No phone number on file for this client.");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const base =
      process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const url = `${base}/book/${org?.slug ?? ""}/checkout/${id}`;
    const paid = s.amountPaidCents ?? 0;
    const balance = Math.max(0, s.rateCents - paid);
    await notify(ctx, {
      orgId,
      channel: "sms",
      recipient: artist.phone,
      subject: "Pay link",
      body: `${org?.name ?? "The studio"}: your balance of ${money(balance)} for "${s.title}". Pay securely here: ${url}`,
      kind: "session.paylink",
      sessionId: id,
    });
    return { ok: true };
  },
});

/* ── Engineer request lifecycle (public bookings) ──────────────
   A client who needs an engineer picks one at booking time; the session sits
   tentative until THAT engineer confirms (or a manager/owner overrides). */

/** The signed-in engineer's pending requests - drives the confirm panel on
 *  Schedule and the mobile Clock page. Returns [] for non-members. */
export const myEngineerRequests = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "studio_member") return [];
    const memberId = viewer.memberId as unknown as string;
    if (!memberId || memberId === "demo") return [];
    const now = Date.now();
    const rows = (
      await ctx.db
        .query("sessions")
        .withIndex("by_org", (q) => q.eq("orgId", viewer.orgId))
        .collect()
    ).filter(
      (x) =>
        x.engineerId === viewer.memberId &&
        x.engineerRequestStatus === "pending" &&
        x.endTime >= now &&
        x.status !== "cancelled",
    );
    return await Promise.all(
      rows
        .sort((a, b) => a.startTime - b.startTime)
        .map(async (x) => {
          const [artist, room] = await Promise.all([
            ctx.db.get(x.artistId),
            x.roomId ? ctx.db.get(x.roomId) : null,
          ]);
          return {
            _id: x._id,
            title: x.title,
            artistName: artist?.name ?? "Client",
            roomName: room?.name ?? null,
            startTime: x.startTime,
            endTime: x.endTime,
            serviceType: x.serviceType,
          };
        }),
    );
  },
});

/** The requested engineer accepts or declines. Accepting finalizes the
 *  booking (session -> confirmed + auto-shift); declining clears the
 *  assignment so managers can restaff (session stays tentative). */
export const respondToEngineerRequest = mutation({
  args: { sessionId: v.id("sessions"), accept: v.boolean() },
  handler: async (ctx, { sessionId, accept }) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind !== "studio_member") throw new Error("Only studio staff can respond.");
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== viewer.orgId) throw new Error("Session not found");
    if (session.engineerId !== viewer.memberId) {
      throw new Error("This request was sent to a different engineer.");
    }
    if (session.engineerRequestStatus !== "pending") {
      throw new Error("This request has already been handled.");
    }
    const me = await ctx.db.get(viewer.memberId);
    const name = me?.name ?? "Engineer";
    if (accept) {
      await ctx.db.patch(sessionId, {
        engineerRequestStatus: "confirmed",
        status: "confirmed",
      });
      await ensureSessionShift(ctx, {
        _id: sessionId,
        orgId: session.orgId,
        engineerId: session.engineerId,
        roomId: session.roomId ?? null,
        startTime: session.startTime,
        endTime: session.endTime,
      });
      await ctx.db.insert("activity", {
        orgId: session.orgId,
        kind: "engineer.confirmed",
        summary: `${name} confirmed ${session.title} - booking finalized`,
        actorName: name,
        entityType: "session",
        entityId: sessionId,
        accent: "positive",
      });
    } else {
      await ctx.db.patch(sessionId, {
        engineerId: undefined,
        engineerRequestStatus: "declined",
      });
      await ctx.db.insert("activity", {
        orgId: session.orgId,
        kind: "engineer.declined",
        summary: `${name} declined ${session.title} - needs restaffing`,
        actorName: name,
        entityType: "session",
        entityId: sessionId,
        accent: "critical",
      });
    }
    return { ok: true };
  },
});

/** Manager/owner override: finalize the booking without waiting on the
 *  requested engineer's confirmation. */
export const overrideEngineerConfirmation = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new Error("Session not found");
    if (session.engineerRequestStatus !== "pending") {
      throw new Error("This request has already been handled.");
    }
    await ctx.db.patch(sessionId, {
      engineerRequestStatus: "overridden",
      status: "confirmed",
    });
    await ensureSessionShift(ctx, {
      _id: sessionId,
      orgId,
      engineerId: session.engineerId ?? null,
      roomId: session.roomId ?? null,
      startTime: session.startTime,
      endTime: session.endTime,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "engineer.confirmed",
      summary: `${session.title} finalized by management override`,
      entityType: "session",
      entityId: sessionId,
      accent: "gold",
    });
    return { ok: true };
  },
});
