import { mutation } from "./functions";
import { internalAction } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { resolveViewer } from "./lib/access";

/* Deleting your own account.
 *
 * App Review guideline 5.1.1(v): an app that lets people create an account
 * must let them delete it, in the app. What "delete" means here is decided
 * by whose data it is. The login is the person's - it goes, at Clerk, with
 * every device registered to it. The studio's records are the studio's: the
 * shifts worked, the hours clocked, the sessions engineered are payroll and
 * history, and they stay, with the person's identity taken off them. The
 * member row becomes "Former teammate" with no email, phone, photo or link
 * to any login, so it can never sign in again and never be contacted.
 *
 * A studio's only owner cannot leave this way: the studio would be left
 * with nobody able to run it. They make another owner first, or delete the
 * studio itself from the web app.
 */
export const deleteMe = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const clerkUserId = identity.subject;
    const viewer = await resolveViewer(ctx);

    if (viewer.kind === "studio_member" && viewer.role === "owner") {
      const others = (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", viewer.orgId))
          .collect()
      ).filter((m) => m.role === "owner" && m.clerkUserId && m.clerkUserId !== clerkUserId);
      if (others.length === 0) {
        throw new ConvexError(
          "You are the only owner of this studio, so deleting your account would leave nobody able to run it. Make another teammate an owner first, or delete the studio from the web app.",
        );
      }
    }

    // Every seat this login holds - an account can sit on more than one studio.
    const seats = await ctx.db
      .query("members")
      .withIndex("by_clerk", (q) => q.eq("clerkUserId", clerkUserId))
      .collect();
    for (const seat of seats) {
      await ctx.db.patch(seat._id, {
        name: "Former teammate",
        email: undefined,
        phone: undefined,
        clerkUserId: undefined,
        notes: undefined,
        photoId: undefined,
        clerkImageUrl: undefined,
        bio: undefined,
        credits: undefined,
        spotifyUrl: undefined,
        playlistUrls: undefined,
      });
    }

    // Nothing may reach this person's devices after this.
    for (const d of await ctx.db.query("apnsDevices").collect()) {
      if (d.clerkUserId === clerkUserId) await ctx.db.delete(d._id);
    }
    for (const s of await ctx.db.query("pushSubscriptions").collect()) {
      if (s.clerkUserId === clerkUserId) await ctx.db.delete(s._id);
    }

    // The login itself, at Clerk. Scheduled, because it is a call out of the
    // building and the rows above must be committed whether or not it lands.
    await ctx.scheduler.runAfter(0, internal.account.deleteClerkUser, { clerkUserId });
    return { seatsReleased: seats.length };
  },
});

/** Remove the login at Clerk. Idempotent: a user already gone answers 404. */
export const deleteClerkUser = internalAction({
  args: { clerkUserId: v.string() },
  handler: async (_ctx, { clerkUserId }): Promise<{ deleted: boolean; status: number }> => {
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) return { deleted: false, status: 0 };
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}` },
    });
    return { deleted: res.ok || res.status === 404, status: res.status };
  },
});
