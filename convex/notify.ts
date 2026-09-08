import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/* One alert, every device the studio has.
 *
 * There are two transports - web push for browsers and the PWA, APNs for the
 * native apps - and no caller should have to know that. Before this, the one
 * place that raised an alert called web push directly, so the day the iPhone
 * app arrived every alert in the product silently skipped it.
 *
 * Anything that wants to reach a studio's devices goes through here, so a new
 * alert cannot be born knowing about only half of them.
 */
export const toOrg = internalAction({
  args: {
    orgId: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    tag: v.optional(v.string()),
    clerkUserIds: v.optional(v.array(v.string())),
    /* When true, `clerkUserIds` is the ONLY audience.
     *
     * The fallback below - ping everybody when the named people have no device
     * - is right for "the room turns over in ten minutes", which anybody on
     * shift can act on. It is wrong for "you have not clocked in", which would
     * then tell the whole studio about one person. An alert addressed to
     * somebody who is not reachable should go nowhere. */
    strictAudience: v.optional(v.boolean()),
    /** Never these people, whatever the audience resolves to. */
    exceptClerkUserIds: v.optional(v.array(v.string())),
  },
  // The explicit return type is load-bearing. Without it Convex's generated
  // api.d.ts has to infer through notify -> apns -> internal.push -> ... and
  // gives up, at which point EVERY inferred callback parameter in the whole
  // codebase quietly becomes `any`. It compiled and it was a hole in the type
  // system, sixty files wide.
  handler: async (ctx, args): Promise<{ web: number; apple: number }> => {
    // Both are attempted whatever the other does. A studio with no VAPID keys
    // must still reach its phones, and a studio with no APNs key must still
    // reach its browsers.
    const [web, apple] = await Promise.all([
      ctx.runAction(internal.pushSend.sendToOrg, args).catch(() => ({ sent: 0 })),
      ctx.runAction(internal.apns.sendToOrg, args).catch(() => ({ sent: 0 })),
    ]);
    return { web: web.sent, apple: apple.sent };
  },
});
