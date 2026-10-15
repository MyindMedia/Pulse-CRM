import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { staffSession, staffSessionOrNull, canModerate } from "./lib/sessionAccess";

/* ============================================================
   Session notes: staff-only notes on one booking, written from the
   session modal. Never sent to the client and never read by a public
   page: every function here needs a signed-in staff member of the
   booking's own studio (lib/sessionAccess.ts).

     read    sessions.read
     write   sessions.read (anyone on staff who can see the booking can
             leave a note for the team)
     delete  the author, or an owner / manager (schedule.manage)
   ============================================================ */

const MAX_BODY = 4000;
const MAX_LIST = 200;

/** Notes on a booking, newest first, with whether the caller may delete each.
 *  Null when the caller may not see this booking. */
export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const access = await staffSessionOrNull(ctx, sessionId);
    if (!access) return null;
    const rows = await ctx.db
      .query("sessionNotes")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(MAX_LIST);
    const moderator = canModerate(access.viewer);
    return rows
      .filter((r) => r.orgId === access.orgId)
      .map((r) => ({
        _id: r._id,
        body: r.body,
        authorName: r.authorName,
        authorMemberId: r.authorMemberId ?? null,
        createdAt: r.createdAt,
        mine: r.authorClerkUserId === access.actorId,
        canDelete: moderator || r.authorClerkUserId === access.actorId,
      }));
  },
});

export const add = mutation({
  args: { sessionId: v.id("sessions"), body: v.string() },
  handler: async (ctx, { sessionId, body }) => {
    const access = await staffSession(ctx, sessionId);
    const text = body.trim();
    if (!text) throw new ConvexError("Write a note first.");
    if (text.length > MAX_BODY) throw new ConvexError(`Keep notes under ${MAX_BODY} characters.`);
    return await ctx.db.insert("sessionNotes", {
      orgId: access.orgId,
      sessionId,
      body: text,
      authorMemberId: access.memberId,
      authorClerkUserId: access.actorId,
      authorName: access.actorName,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { noteId: v.id("sessionNotes") },
  handler: async (ctx, { noteId }) => {
    const note = await ctx.db.get(noteId);
    if (!note) throw new ConvexError("Note not found.");
    const access = await staffSession(ctx, note.sessionId);
    if (note.orgId !== access.orgId) throw new ConvexError("Note not found.");
    if (note.authorClerkUserId !== access.actorId && !canModerate(access.viewer)) {
      throw new ConvexError("Only the author or an owner or manager can delete this note.");
    }
    await ctx.db.delete(noteId);
    return null;
  },
});
