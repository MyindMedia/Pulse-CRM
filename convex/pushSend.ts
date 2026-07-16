"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import webpush from "web-push";

/* Web-push delivery - Node runtime (the web-push package needs Node crypto).
   Fans one alert out to every registered device in the org. Dead endpoints
   (404/410 from the push service) are pruned so the list self-heals. No-op
   until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set on the deployment. */

export const sendToOrg = internalAction({
  args: {
    orgId: v.string(),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, title, body, url, tag }) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return { sent: 0, reason: "vapid-unset" };
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:info@myindsound.com",
      publicKey,
      privateKey,
    );

    const subs = await ctx.runQuery(internal.push._forOrg, { orgId });
    let sent = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title, body, url: url ?? "/dashboard", tag }),
          { TTL: 600, urgency: "high" },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await ctx.runMutation(internal.push._prune, { endpoint: sub.endpoint });
        }
        // Other failures (transient network, throttling) just skip this device.
      }
    }
    return { sent };
  },
});
