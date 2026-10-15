import { query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { currentOrg, currentOrgWithCapability } from "./lib/tenant";
import { resolveMemberEmail, notify } from "./lib/notify";
import { changeDecided } from "./lib/bookingMessages";
import {
  bookingFactsFor,
  describeRequest,
  mayDecide,
  resolveActor,
  type Actor,
} from "./lib/changeApproval";
import { applyAssignEngineer, applyReschedule, applyStatus } from "./sessions";

/* ============================================================
   Change approvals on existing bookings (bookingFeatures.changeApproval).
   Proposals are written by the guard in sessions.ts (origin "pulse") and by
   the Google sync when someone edits a Pulse event in Google (origin
   "google"). Approving runs the change through the same helpers a direct
   edit uses, so conflict checks, room status, the Google push and fees
   behave exactly the same. See lib/changeApproval.ts for who decides.
   ============================================================ */

type Request = Doc<"sessionChangeRequests">;

async function loadPending(
  ctx: MutationCtx,
  orgId: string,
  requestId: Id<"sessionChangeRequests">,
): Promise<{ request: Request; session: Doc<"sessions"> }> {
  const request = await ctx.db.get(requestId);
  if (!request || request.orgId !== orgId) throw new ConvexError("Change request not found.");
  if (request.status !== "pending") throw new ConvexError("This change was already decided.");
  const session = await ctx.db.get(request.sessionId);
  if (!session || session.orgId !== orgId) throw new ConvexError("That booking no longer exists.");
  return { request, session };
}

async function deciderFor(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  request: Request,
): Promise<Actor> {
  const actor = await resolveActor(ctx);
  if (!mayDecide(actor, session, request)) {
    throw new ConvexError("Only the person who booked this, or an owner, can decide this change.");
  }
  return actor;
}

async function memberName(ctx: QueryCtx | MutationCtx, id: Id<"members"> | undefined, fallback: string) {
  if (!id) return fallback;
  return (await ctx.db.get(id))?.name ?? fallback;
}

/** Tell the requester how their proposal went: email + push. */
async function tellRequester(
  ctx: MutationCtx,
  request: Request,
  session: Doc<"sessions">,
  deciderName: string,
  approved: boolean,
  summary: string,
) {
  if (!request.requestedByMemberId) return; // Google-origin: nobody to tell
  const msg = changeDecided({ ...(await bookingFactsFor(ctx, session)), deciderName, approved, summary });
  const email = await resolveMemberEmail(ctx, request.requestedByMemberId);
  if (email) {
    await notify(ctx, {
      orgId: request.orgId,
      channel: "email",
      recipient: email,
      subject: msg.subject,
      body: msg.body,
      kind: "session.change_decided",
      sessionId: session._id,
    });
  }
  const requester = await ctx.db.get(request.requestedByMemberId);
  if (requester?.clerkUserId) {
    await ctx.scheduler.runAfter(0, internal.notify.toOrg, {
      orgId: request.orgId,
      title: msg.subject,
      body: summary,
      url: `/calendar?session=${session._id}`,
      tag: `change-${request._id}`,
      clerkUserIds: [requester.clerkUserId],
      strictAudience: true,
    });
  }
}

/** Approve: apply the change through the same code paths a direct edit
 *  uses. A conflict at approval time throws and the request stays pending. */
export const approve = mutation({
  args: { requestId: v.id("sessionChangeRequests") },
  handler: async (ctx, { requestId }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const { request, session } = await loadPending(ctx, orgId, requestId);
    const actor = await deciderFor(ctx, session, request);
    const summary = await describeRequest(ctx, session, request.proposed);
    const p = request.proposed;

    let current = session;
    let staffingWarning: string | null = null;
    if (p.status === "cancelled") {
      await applyStatus(ctx, orgId, current, "cancelled");
    } else {
      const moves =
        (p.startTime !== undefined && p.startTime !== current.startTime) ||
        (p.endTime !== undefined && p.endTime !== current.endTime) ||
        (p.roomId !== undefined && p.roomId !== current.roomId);
      if (moves) {
        await applyReschedule(
          ctx,
          orgId,
          current,
          p.startTime ?? current.startTime,
          p.endTime ?? current.endTime,
          p.roomId,
        );
        current = (await ctx.db.get(current._id))!;
      }
      if (p.engineerId !== undefined && p.engineerId !== current.engineerId) {
        const eng = await ctx.db.get(p.engineerId);
        if (!eng || eng.orgId !== orgId) throw new ConvexError("That engineer is no longer on the team.");
        ({ staffingWarning } = await applyAssignEngineer(ctx, orgId, current, p.engineerId));
      }
      if (p.status !== undefined && p.status !== current.status) {
        await applyStatus(ctx, orgId, current, p.status);
      }
    }

    const decidedAt = Date.now();
    await ctx.db.patch(requestId, {
      status: "approved",
      decidedByMemberId: actor.memberId,
      decidedAt,
    });
    // A Google edit that is now in Pulse is no longer a pending Google change.
    if (request.origin === "google") await ctx.db.patch(session._id, { googleChangedAt: undefined });

    const deciderName = await memberName(ctx, actor.memberId, "An owner");
    const requesterName = await memberName(ctx, request.requestedByMemberId, "Google Calendar");
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.change_approved",
      summary: `${deciderName} approved ${requesterName}'s change to ${session.title}: ${summary}`,
      entityType: "session",
      entityId: session._id,
      accent: "positive",
    });
    await tellRequester(ctx, request, session, deciderName, true, summary);
    return { ok: true as const, staffingWarning };
  },
});

/** Decline: the booking stays as it is. A Google-origin decline puts Google
 *  back to match Pulse. */
export const decline = mutation({
  args: { requestId: v.id("sessionChangeRequests"), note: v.optional(v.string()) },
  handler: async (ctx, { requestId, note }) => {
    const orgId = await currentOrgWithCapability(ctx, "sessions.edit");
    const { request, session } = await loadPending(ctx, orgId, requestId);
    const actor = await deciderFor(ctx, session, request);
    const summary = await describeRequest(ctx, session, request.proposed);

    await ctx.db.patch(requestId, {
      status: "declined",
      decidedByMemberId: actor.memberId,
      decidedAt: Date.now(),
    });

    if (request.origin === "google") {
      await ctx.db.patch(session._id, { googleChangedAt: undefined });
      // The trigger only pushes on calendar fields, and none changed here, so
      // push the booking explicitly. pushSession no-ops when not connected.
      await ctx.scheduler.runAfter(0, internal.googleCalendar.pushSession, { sessionId: session._id });
    }

    const deciderName = await memberName(ctx, actor.memberId, "An owner");
    const requesterName = await memberName(ctx, request.requestedByMemberId, "Google Calendar");
    const trimmed = note?.trim();
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.change_declined",
      summary: `${deciderName} declined ${requesterName}'s change to ${session.title}: ${summary}${trimmed ? ` (${trimmed})` : ""}`,
      entityType: "session",
      entityId: session._id,
      accent: "caution",
    });
    await tellRequester(ctx, request, session, deciderName, false, trimmed ? `${summary}. Note: ${trimmed}` : summary);
    return { ok: true as const };
  },
});

/** Withdraw your own pending proposal. */
export const withdraw = mutation({
  args: { requestId: v.id("sessionChangeRequests") },
  handler: async (ctx, { requestId }) => {
    const orgId = await currentOrg(ctx);
    const { request, session } = await loadPending(ctx, orgId, requestId);
    const actor = await resolveActor(ctx);
    if (!actor.memberId || request.requestedByMemberId !== actor.memberId) {
      throw new ConvexError("Only the person who asked can withdraw this change.");
    }
    await ctx.db.patch(requestId, { status: "withdrawn", decidedByMemberId: actor.memberId, decidedAt: Date.now() });
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.change_withdrawn",
      summary: `${await memberName(ctx, actor.memberId, "A teammate")} withdrew a change to ${session.title}`,
      entityType: "session",
      entityId: session._id,
      accent: "info",
    });
    return { ok: true as const };
  },
});

/* ── Reads ─────────────────────────────────────────────────── */

async function hydrateRequest(ctx: QueryCtx, r: Request, session: Doc<"sessions">, actor: Actor) {
  const [summary, requesterName, approverName, artist] = await Promise.all([
    describeRequest(ctx, session, r.proposed),
    memberName(ctx, r.requestedByMemberId, "Google Calendar"),
    memberName(ctx, r.approverMemberId, "the owner"),
    ctx.db.get(session.artistId),
  ]);
  return {
    _id: r._id,
    _creationTime: r._creationTime,
    sessionId: r.sessionId,
    sessionTitle: session.title,
    sessionStart: session.startTime,
    clientName: artist?.name ?? "Client",
    origin: r.origin,
    reason: r.reason ?? null,
    summary,
    requesterName,
    approverName,
    canDecide: mayDecide(actor, session, r),
    isMine: actor.memberId !== undefined && r.requestedByMemberId === actor.memberId,
  };
}

/** Pending changes on one booking, for the banner on the booking sheets. */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return [];
    const rows = (
      await ctx.db.query("sessionChangeRequests").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect()
    ).filter((r) => r.status === "pending");
    if (rows.length === 0) return [];
    const actor = await resolveActor(ctx);
    return Promise.all(rows.map((r) => hydrateRequest(ctx, r, session, actor)));
  },
});

/** "Changes waiting for you": every pending change this person may decide. */
export const pendingForMe = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const actor = await resolveActor(ctx);
    const pending = await ctx.db
      .query("sessionChangeRequests")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .take(200);
    const out = [];
    for (const r of pending) {
      const session = await ctx.db.get(r.sessionId);
      if (!session || session.orgId !== orgId) continue;
      if (!mayDecide(actor, session, r)) continue;
      out.push(await hydrateRequest(ctx, r, session, actor));
    }
    return out.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Booking ids with a pending change, for the small dot on the calendar. */
export const pendingSessionIds = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const pending = await ctx.db
      .query("sessionChangeRequests")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "pending"))
      .take(500);
    return [...new Set(pending.map((r) => r.sessionId))];
  },
});
