import { query, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { sendEmail } from "./lib/email";
import { sendSms } from "./lib/sms";

/* Notifications - the confirmation / reminder log. Written by the notify()
   seam, DELIVERED by the `deliver` action below (Resend email / configured
   SMS provider), and surfaced read-only in the internal Bookings view. */

export const _get = internalQuery({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const _setStatus = internalMutation({
  args: {
    id: v.id("notifications"),
    status: v.union(v.literal("simulated"), v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

/** Actually deliver a queued notification. Email goes out via Resend, SMS via
    the configured provider; either helper degrades to "simulated" when its
    provider isn't configured, so unconfigured deployments just keep the log. */
export const deliver = internalAction({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    const n = await ctx.runQuery(internal.notifications._get, { id });
    if (!n) return;
    let status: "sent" | "failed" | "simulated";
    if (n.channel === "email") {
      // Linkify bare URLs (e.g. invoice payment links) so they're clickable.
      const escaped = n.body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const linked = escaped.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" style="color:#b8860b">$1</a>',
      );
      const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#111">${linked
        .split("\n")
        .map((l: string) => l.trim())
        .join("<br/>")}</div>`;
      status = await sendEmail({ to: n.recipient, subject: n.subject, html });
    } else {
      status = await sendSms({ to: n.recipient, body: n.body });
    }
    await ctx.runMutation(internal.notifications._setStatus, { id, status });
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    return await ctx.db
      .query("notifications")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 30);
  },
});

export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return rows
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});
