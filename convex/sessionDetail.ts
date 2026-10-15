import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { staffSessionOrNull, holds } from "./lib/sessionAccess";
import { effectiveStatus } from "./invoices";

/* ============================================================
   Everything around a booking the session modal shows next to the
   booking itself: the invoices raised for it, arrival prep, who created
   and decided it, and its change history. One read, staff only, the
   booking's own studio only. Invoice figures only reach a caller who may
   see client money (invoices.read).
   ============================================================ */

const HISTORY_SCAN = 400;
const HISTORY_MAX = 30;

export const extras = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId);
    if (!access) return null;
    const { orgId, session } = access;
    const seesMoney = holds(access.viewer, "invoices.read");

    // Invoices raised for this booking (there is no by_session index, so walk
    // the client's own invoices, which is a short list).
    const invoices = seesMoney
      ? (
          await ctx.db
            .query("invoices")
            .withIndex("by_artist", (q) => q.eq("artistId", session.artistId))
            .take(200)
        )
          .filter((inv) => inv.orgId === orgId && inv.sessionId === sessionId)
          .map((inv) => ({
            _id: inv._id,
            number: inv.number,
            status: effectiveStatus(inv),
            amountCents: inv.amountCents,
            dueDate: inv.dueDate,
            paidAt: inv.paidAt ?? null,
          }))
      : [];

    const prep = await ctx.db
      .query("arrivalPrep")
      .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId))
      .first();

    const name = async (id: Id<"members"> | undefined) => (id ? (await ctx.db.get(id))?.name ?? null : null);

    // Change history: the activity trail for this booking plus any change
    // requests (proposals, Google moves) and how they were decided.
    const activity = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(HISTORY_SCAN);
    const history = activity
      .filter((a) => (a.entityType === "session" || a.entityType === "booking") && a.entityId === sessionId)
      .slice(0, HISTORY_MAX)
      .map((a) => ({ _id: a._id, kind: a.kind, summary: a.summary, actorName: a.actorName ?? null, at: a._creationTime, accent: a.accent ?? null }));

    const changeRows = await ctx.db
      .query("sessionChangeRequests")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .take(50);
    const changes = await Promise.all(
      changeRows
        .filter((c) => c.orgId === orgId)
        .sort((a, b) => b._creationTime - a._creationTime)
        .map(async (c) => ({
          _id: c._id,
          origin: c.origin,
          status: c.status,
          reason: c.reason ?? null,
          proposed: c.proposed,
          requestedBy: await name(c.requestedByMemberId),
          decidedBy: await name(c.decidedByMemberId),
          decidedAt: c.decidedAt ?? null,
          at: c._creationTime,
        })),
    );

    return {
      seesMoney,
      invoices,
      prep: prep ? { done: prep.done, attribution: prep.attribution ?? [] } : null,
      createdBy: await name(session.createdByMemberId),
      requestDecidedBy: await name(session.requestDecidedBy),
      source: session.source ?? null,
      history,
      changes,
    };
  },
});
