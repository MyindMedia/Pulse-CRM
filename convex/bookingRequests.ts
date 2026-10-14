/* ============================================================
   Booking requests + approval (docs/plans/hardcover-booking.md, A).

   A public booking lands as a REQUEST (sessions.requestStatus "pending",
   status "tentative", no hold expiry) when the studio turns on
   bookingFeatures.requireApproval, or hides pricing (hidePricing: nothing
   was paid, so nothing should confirm on its own). The request holds the
   slot (lib/roomBusy.sessionHoldsSlot) until an owner or manager decides:

   - approve: requestStatus approved. Status goes to confirmed, EXCEPT when
     the link showed prices and a deposit is still owed: then it stays
     tentative and the booker gets the pay link; paying confirms it through
     the normal settlement path (payments.settlePayment).
   - decline: requestStatus declined, status cancelled, the slot frees up.
     Refunds are NOT automatic: a paid deposit is reported back so the
     staff UI can warn that it needs refunding by hand.

   Both decisions need `schedule.manage`, which owners and managers hold
   and engineers, assistants, interns and accountants do not.
   ============================================================ */
import { v } from "convex/values";
import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability, currentMoneySight } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
import { normalizePhone } from "./lib/phone";
import { money } from "./lib/money";
import { appUrl } from "./lib/links";
import { orgTz } from "./lib/tz";
import {
  requestReceived,
  newRequestForStaff,
  requestApproved,
  requestDeclined,
  whenText,
  type BookingFacts,
} from "./lib/bookingMessages";
import { recomputeRoomStatus } from "./lib/roomStatus";
import { ensureSessionShift } from "./shifts";
import { currentMemberId } from "./sessions";

const DAY = 86_400_000;
const APPROVER_ROLES = new Set(["owner", "manager"]);

async function orgOf(ctx: QueryCtx, orgId: string) {
  return await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

/** Plain facts for the message templates. */
export async function requestFacts(
  ctx: QueryCtx,
  session: Doc<"sessions">,
  org: Doc<"orgs"> | null,
): Promise<BookingFacts & { clientEmail: string | null; clientPhone: string | null }> {
  const [artist, room, engineer] = await Promise.all([
    ctx.db.get(session.artistId),
    session.roomId ? ctx.db.get(session.roomId) : null,
    session.engineerId ? ctx.db.get(session.engineerId) : null,
  ]);
  return {
    studioName: org?.name ?? "the studio",
    clientName: artist?.name ?? "there",
    clientEmail: artist?.email ?? null,
    clientPhone: artist?.phone ? normalizePhone(artist.phone) : null,
    roomName: room?.name,
    engineerName: engineer?.name,
    startTime: session.startTime,
    endTime: session.endTime,
    timeZone: orgTz(org),
    address: org?.contact?.address?.trim() || undefined,
    studioPhone: org?.contact?.phone?.trim() || undefined,
  };
}

/** Owners and managers of a studio: the people who decide requests. */
async function approvers(ctx: QueryCtx, orgId: string) {
  return (
    await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).filter((m) => APPROVER_ROLES.has(m.role));
}

const NOTHING_CHARGED = "Nothing is charged until the studio confirms.";

/**
 * Tell everyone a request just landed. Called by booking.createBooking when
 * the booking is a request. Booker: email + text. Owners and managers:
 * email each, plus a push to their devices. The inbox card is the
 * `bookingRequests.pending` query, so there is no row to write for it.
 *
 * `payUrl` is set when the link showed prices: the booker pays the deposit
 * as today, and the request still waits for approval.
 */
export async function announceRequest(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    org: Doc<"orgs"> | null;
    depositCents: number;
    payUrl?: string;
    detailLines?: string;
  },
): Promise<void> {
  const { session, org } = args;
  const facts = await requestFacts(ctx, session, org);

  // ── Booker ──
  const msg = requestReceived(facts);
  const depositLine = args.payUrl && args.depositCents > 0
    ? `To keep your request moving, pay the ${money(args.depositCents)} deposit: ${args.payUrl}\nIt counts toward your session, and the studio will review your request either way.`
    : null;
  const body = depositLine ? msg.body.replace(NOTHING_CHARGED, depositLine) : msg.body;
  if (facts.clientEmail) {
    await notify(ctx, {
      orgId: session.orgId,
      channel: "email",
      recipient: facts.clientEmail,
      subject: msg.subject,
      body,
      kind: "booking.request_received",
      sessionId: session._id,
    });
  }
  if (facts.clientPhone) {
    await notify(ctx, {
      orgId: session.orgId,
      channel: "sms",
      recipient: facts.clientPhone,
      subject: msg.subject,
      body: depositLine && args.payUrl
        ? `${msg.sms} Deposit: ${args.payUrl}`
        : msg.sms,
      kind: "booking.request_received",
      sessionId: session._id,
    });
  }

  // ── Owners + managers ──
  const reviewUrl = `${appUrl()}/inbox`;
  const staff = newRequestForStaff({ ...facts, reviewUrl });
  const staffBody = args.detailLines ? `${staff.body}\n${args.detailLines}` : staff.body;
  const people = await approvers(ctx, session.orgId);
  const emails = new Set<string>();
  for (const m of people) if (m.email) emails.add(m.email.trim().toLowerCase());
  if (emails.size === 0) {
    // Nobody with an address on file: notifyTeam falls back to the owner email.
    await notifyTeam(ctx, {
      orgId: session.orgId,
      subject: staff.subject,
      body: staffBody,
      kind: "booking.request_staff",
      sessionId: session._id,
    });
  } else {
    for (const email of emails) {
      await notifyTeam(ctx, {
        orgId: session.orgId,
        subject: staff.subject,
        body: staffBody,
        kind: "booking.request_staff",
        sessionId: session._id,
        toEmail: email,
      });
    }
  }
  const clerkUserIds = people.map((m) => m.clerkUserId).filter((x): x is string => Boolean(x));
  if (clerkUserIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.notify.toOrg, {
      orgId: session.orgId,
      title: staff.subject,
      body: staff.sms,
      url: "/inbox",
      tag: `booking-request-${session._id}`,
      clerkUserIds,
      // Only the people who can decide; never the whole floor.
      strictAudience: true,
    });
  }
}

/** Pending requests for owners and managers: the inbox section. */
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const sight = await currentMoneySight(ctx);
    const now = Date.now();
    const rows = (
      await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - DAY))
        .collect()
    ).filter((s) => s.requestStatus === "pending" && s.status !== "cancelled");
    return await Promise.all(
      rows
        .sort((a, b) => a.startTime - b.startTime)
        .map(async (s) => {
          const [artist, room, engineer] = await Promise.all([
            ctx.db.get(s.artistId),
            s.roomId ? ctx.db.get(s.roomId) : null,
            s.engineerId ? ctx.db.get(s.engineerId) : null,
          ]);
          return {
            _id: s._id,
            title: s.title,
            clientName: artist?.name ?? "Client",
            clientEmail: artist?.email ?? null,
            clientPhone: artist?.phone ?? null,
            roomName: room?.name ?? null,
            startTime: s.startTime,
            endTime: s.endTime,
            engineerName: engineer?.name ?? null,
            engineerRequestStatus: s.engineerRequestStatus ?? null,
            gear: (s.addOns ?? []).map((a) => a.name),
            serviceAddOns: (s.serviceAddOns ?? []).map((a) => a.label),
            gearRequestNote: s.gearRequestNote ?? null,
            notes: s.notes ?? null,
            pricingHidden: s.pricingHidden === true,
            // Money only for people allowed to see client money.
            ...(sight.money
              ? {
                  rateCents: s.rateCents,
                  depositCents: s.depositCents,
                  amountPaidCents: s.amountPaidCents ?? 0,
                }
              : {}),
            createdAt: s._creationTime,
          };
        }),
    );
  },
});

async function loadPending(ctx: MutationCtx, orgId: string, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== orgId) throw new Error("Booking not found.");
  if (session.requestStatus !== "pending") {
    throw new Error("This request has already been decided.");
  }
  return session;
}

/** Approve a booking request. Owners and managers only. */
export const approve = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const session = await loadPending(ctx, orgId, sessionId);
    const org = await orgOf(ctx, orgId);
    const decidedBy = await currentMemberId(ctx);
    const paid = session.amountPaidCents ?? 0;
    /* Decision (documented in the plan report): when the link showed prices
       and the deposit is still owed, approving does NOT confirm. The booking
       stays tentative and the booker gets the pay link; the deposit landing
       confirms it through payments.settlePayment like any public booking.
       A request from a link without prices never owes a public deposit. */
    const depositDue =
      !session.pricingHidden && session.depositCents > 0 && paid < session.depositCents;

    await ctx.db.patch(sessionId, {
      requestStatus: "approved",
      requestDecidedAt: Date.now(),
      ...(decidedBy ? { requestDecidedBy: decidedBy } : {}),
      ...(depositDue ? {} : { status: "confirmed" as const }),
    });
    if (!depositDue) {
      if (session.roomId) await recomputeRoomStatus(ctx, session.roomId);
      // The engineer already said yes while it was a request: book their shift now.
      if (session.engineerId && session.engineerRequestStatus === "confirmed") {
        await ensureSessionShift(ctx, {
          _id: sessionId,
          orgId,
          engineerId: session.engineerId,
          roomId: session.roomId ?? null,
          startTime: session.startTime,
          endTime: session.endTime,
        });
      }
    }

    const facts = await requestFacts(ctx, session, org);
    const msg = requestApproved(facts);
    let subject = msg.subject;
    let body = msg.body;
    let sms = msg.sms;
    if (depositDue) {
      const payUrl = `${appUrl()}/book/${org?.slug ?? ""}/checkout/${sessionId}`;
      const due = money(session.depositCents - paid);
      const { date, time } = whenText(facts);
      subject = `Approved: pay your deposit to confirm, ${facts.studioName}`;
      body = msg.body
        .replace(
          `You're confirmed at ${facts.studioName}. Here are your details:`,
          `${facts.studioName} approved your request. Pay the ${due} deposit to confirm it:\n${payUrl}\n\nHere are your details:`,
        );
      sms = `${facts.studioName}: your request for ${date}, ${time} is approved. Pay the ${due} deposit to confirm: ${payUrl}`;
    }
    if (facts.clientEmail) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: facts.clientEmail,
        subject,
        body,
        kind: "booking.request_approved",
        sessionId,
      });
    }
    if (facts.clientPhone) {
      await notify(ctx, {
        orgId,
        channel: "sms",
        recipient: facts.clientPhone,
        subject,
        body: sms,
        kind: "booking.request_approved",
        sessionId,
      });
    }
    const decider = decidedBy ? await ctx.db.get(decidedBy) : null;
    await ctx.db.insert("activity", {
      orgId,
      kind: "booking.request_approved",
      summary: depositDue
        ? `Request approved - ${session.title} (waiting on the deposit)`
        : `Request approved - ${session.title} is confirmed`,
      ...(decider?.name ? { actorName: decider.name } : {}),
      entityType: "session",
      entityId: sessionId,
      accent: "positive",
    });
    return { status: depositDue ? ("tentative" as const) : ("confirmed" as const), depositDue };
  },
});

/** Decline a booking request. Owners and managers only. */
export const decline = mutation({
  args: { sessionId: v.id("sessions"), reason: v.optional(v.string()) },
  handler: async (ctx, { sessionId, reason }) => {
    const orgId = await currentOrgWithCapability(ctx, "schedule.manage");
    const session = await loadPending(ctx, orgId, sessionId);
    const org = await orgOf(ctx, orgId);
    const decidedBy = await currentMemberId(ctx);
    const declineReason = reason?.trim().slice(0, 500) || undefined;
    const paid = session.amountPaidCents ?? 0;

    await ctx.db.patch(sessionId, {
      requestStatus: "declined",
      status: "cancelled",
      requestDecidedAt: Date.now(),
      ...(decidedBy ? { requestDecidedBy: decidedBy } : {}),
      ...(declineReason ? { declineReason } : {}),
    });
    if (session.roomId) await recomputeRoomStatus(ctx, session.roomId);

    const facts = await requestFacts(ctx, session, org);
    const msg = requestDeclined({ ...facts, reason: declineReason });
    if (facts.clientEmail) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: facts.clientEmail,
        subject: msg.subject,
        body: msg.body,
        kind: "booking.request_declined",
        sessionId,
      });
    }
    if (facts.clientPhone) {
      await notify(ctx, {
        orgId,
        channel: "sms",
        recipient: facts.clientPhone,
        subject: msg.subject,
        body: msg.sms,
        kind: "booking.request_declined",
        sessionId,
      });
    }
    const decider = decidedBy ? await ctx.db.get(decidedBy) : null;
    await ctx.db.insert("activity", {
      orgId,
      kind: "booking.request_declined",
      summary:
        `Request declined - ${session.title}` +
        (paid > 0 ? ` (a ${money(paid)} payment needs a manual refund)` : ""),
      ...(decider?.name ? { actorName: decider.name } : {}),
      entityType: "session",
      entityId: sessionId,
      accent: "critical",
    });
    // Refunds are out of scope: tell the caller so the UI can say so.
    return { refundNeededCents: paid };
  },
});
