import { query, internalQuery, internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { AccessError } from "./lib/access";
import { sendEmail, studioReplyTo } from "./lib/email";
import { studioEmailHtml, readableEmailInk } from "./lib/emailTemplates/layout";
import { sendSms } from "./lib/sms";

/* Notifications - the confirmation / reminder log. Written by the notify()
   seam, DELIVERED by the `deliver` action below (Resend email / configured
   SMS provider), and surfaced read-only in the internal Bookings view. */

export const _get = internalQuery({
  args: { id: v.id("notifications") },
  handler: async (ctx, { id }) => {
    const n = await ctx.db.get(id);
    if (!n) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", n.orgId)).first();
    return { ...n, orgName: org?.name ?? "Your studio", replyTo: studioReplyTo(org) };
  },
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

/** The HTML a queued email row is sent as. A row with a designed body (`html`,
 *  which carries its own button) gets it inside the studio layout with the
 *  studio's accent on the header bar; every other row renders exactly as
 *  before, from the plain `body`. */
export function notificationEmailHtml(n: { orgName: string; body: string; html?: string; accent?: string }): string {
  if (!n.html) return studioEmailHtml({ studioName: n.orgName, bodyText: n.body });
  return studioEmailHtml({
    studioName: n.orgName,
    bodyHtml: n.html,
    accent: n.accent,
    accentInk: n.accent ? readableEmailInk(n.accent) : undefined,
  });
}

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
      // Branded studio-framed email (escapes + linkifies pay URLs internally).
      const html = notificationEmailHtml(n);
      // Replies go to the studio: the bodies say "Reply to this email".
      status = await sendEmail({ to: n.recipient, subject: n.subject, html, replyTo: n.replyTo });
    } else {
      status = await sendSms({ to: n.recipient, body: n.body });
    }
    await ctx.runMutation(internal.notifications._setStatus, { id, status });
  },
});

/** A notification row as the app may see it. The designed email (`html`) is
 *  for sending only: its button holds the client's delivery link and its copy
 *  a dollar amount, and these rows reach every member of the studio, including
 *  staff without money sight. */
export function forStaff<T extends { html?: string }>(n: T): Omit<T, "html"> {
  const out: Partial<T> = { ...n };
  delete out.html;
  return out as Omit<T, "html">;
}

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 30);
    return rows.map(forStaff);
  },
});

/* The transactional events worth pushing to a teammate's phone in-app: money
   landing, sessions moving, and cancellations. Filtered from the org-wide
   `activity` log so the bell's "Activity" view stays signal, not noise. */
const NOTEWORTHY_ACTIVITY = new Set([
  "booking.created",
  "booking.held",
  "booking.forfeited",
  "session.created",
  "session.confirmed",
  "session.completed",
  "session.assigned",
  "invoice.paid",
  "payment.received",
  "shift.cancelled",
  "staff.clocked_in",
  "staff.clocked_out",
  "engineer.requested",
  "engineer.confirmed",
  "engineer.declined",
]);

/** Recent noteworthy activity (bookings, payments, completions, cancellations)
    for the in-app notification bell. Studio-member scoped via currentOrg. */
export const activityFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    // Shell-chrome read: degrade instead of throw while auth settles.
    let orgId: string;
    try {
      orgId = await currentOrg(ctx);
    } catch (e) {
      if (e instanceof AccessError) return [];
      throw e;
    }
    // Over-fetch then filter so we still surface a full page of noteworthy rows
    // even when chatty low-signal activity dominates the raw log.
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(150);
    return rows.filter((r) => NOTEWORTHY_ACTIVITY.has(r.kind)).slice(0, limit ?? 20);
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
      .sort((a, b) => b._creationTime - a._creationTime)
      .map(forStaff);
  },
});
