/* ============================================================
   Waitlist nurture engine - Pulse's OWN owned-channel acquisition.

   Capture:  the marketing "get updates" form calls `join` (a public action,
             mirrors contact.submit). It upserts a `subscribers` row (the source
             of truth) and best-effort pushes the address to the Resend Audience
             so the MYI-52 newsletter broadcast reaches them.

   Nurture:  `nurtureSweep` (hourly cron + an immediate run on each new signup)
             decides which of Day 0 / Day 2 / Day 5 is due, claims that step in
             the transaction (marks nurtureSent), and schedules `deliverNurture`
             to send it. This mirrors notify(): a mutation marks + schedules, an
             action delivers. Idempotent per subscriber per step, deduped via
             subscribers.nurtureSent - the same shape as the reminder crons'
             session.emailRemindersSent. Sends no-op to "simulated" until
             RESEND_API_KEY is set.
   ============================================================ */
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { sendEmail, addAudienceContact } from "./lib/email";
import {
  renderWaitlistEmail,
  WAITLIST_STEPS,
  STEP_DELAY_MS,
  type WaitlistStep,
} from "./lib/waitlistEmails";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * PUBLIC. Join the waitlist from the marketing site. No auth (it's a public
 * capture), validates the address, upserts the subscriber, and pushes the
 * contact to the Resend Audience. Returns `already: true` for a repeat signup
 * so the UI can say "you're already on the list" instead of erroring.
 */
export const join = action({
  args: { email: v.string(), source: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean; already: boolean }> => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Please enter a valid email.");

    const { isNew } = await ctx.runMutation(internal.subscribers.record, {
      email,
      source: args.source?.trim() || undefined,
    });

    // Only new subscribers hit the Resend Audience (avoids duplicate-contact
    // churn on repeat submits). Best-effort: failure here never fails the join.
    if (isNew) {
      const audienceStatus = await addAudienceContact(email);
      await ctx.runMutation(internal.subscribers.setAudienceStatus, { email, audienceStatus });
    }
    return { ok: true, already: !isNew };
  },
});

/**
 * Upsert a subscriber by email. New rows schedule an immediate nurture sweep so
 * the Day 0 welcome goes out at once through the same idempotent path the hourly
 * cron uses (no separate "send welcome" code path). A previously-unsubscribed
 * address is re-subscribed but keeps its nurture history (already-sent steps
 * are not re-sent).
 */
export const record = internalMutation({
  args: { email: v.string(), source: v.optional(v.string()), nowMs: v.optional(v.number()) },
  handler: async (ctx, { email, source, nowMs }) => {
    const now = nowMs ?? Date.now();
    const existing = await ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existing) {
      if (existing.status === "unsubscribed") {
        await ctx.db.patch(existing._id, { status: "subscribed", unsubscribedAt: undefined });
      }
      return { isNew: false, id: existing._id };
    }

    const id = await ctx.db.insert("subscribers", {
      email,
      source,
      status: "subscribed",
      createdAt: now,
      nurtureSent: [],
    });
    await ctx.scheduler.runAfter(0, internal.subscribers.nurtureSweep, {});
    return { isNew: true, id };
  },
});

export const setAudienceStatus = internalMutation({
  args: { email: v.string(), audienceStatus: v.string() },
  handler: async (ctx, { email, audienceStatus }) => {
    const row = await ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (row) await ctx.db.patch(row._id, { audienceStatus });
  },
});

/**
 * The nurture engine. For every subscribed address, find the earliest step that
 * is due and not yet sent, claim it (mark nurtureSent + lastNurtureAt) inside
 * the transaction, and schedule delivery. One step per subscriber per sweep, in
 * order, so a long-dormant sweep never fires all three at once. Marking before
 * delivery is what makes it idempotent (mirrors the reminder crons); a failed
 * send is not retried, same as reminders.
 *
 * Scans the whole table each sweep. That's fine at waitlist scale (hundreds to
 * low thousands); revisit with a due-time index if the list grows large.
 */
export const nurtureSweep = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const now = nowMs ?? Date.now();
    const subs = await ctx.db.query("subscribers").collect();
    let scheduled = 0;

    for (const s of subs) {
      if (s.status !== "subscribed") continue;
      const sent = s.nurtureSent ?? [];
      const age = now - s.createdAt;

      for (const step of WAITLIST_STEPS) {
        if (sent.includes(step)) continue;
        if (age < STEP_DELAY_MS[step]) break; // ordered: nothing later is due either
        await ctx.db.patch(s._id, { nurtureSent: [...sent, step], lastNurtureAt: now });
        await ctx.scheduler.runAfter(0, internal.subscribers.deliverNurture, {
          subscriberId: s._id,
          step,
        });
        scheduled++;
        break; // one step per sweep; the next sweep handles the next due step
      }
    }
    return { scheduled };
  },
});

export const getById = internalQuery({
  args: { id: v.id("subscribers") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

/** Deliver one claimed nurture step. Re-reads the subscriber so a subscriber who
    unsubscribed between claim and delivery is skipped. */
export const deliverNurture = internalAction({
  args: { subscriberId: v.id("subscribers"), step: v.string() },
  handler: async (ctx, { subscriberId, step }) => {
    const sub = await ctx.runQuery(internal.subscribers.getById, { id: subscriberId });
    if (!sub || sub.status !== "subscribed") return;
    const rendered = renderWaitlistEmail(step as WaitlistStep, { email: sub.email });
    if (!rendered) return;
    const status = await sendEmail({ to: sub.email, subject: rendered.subject, html: rendered.html });
    console.log(`[waitlist] nurture ${step} -> ${sub.email}: ${status}`);
  },
});

/** Unsubscribe an address. Idempotent and never throws for an unknown address,
    so the public GET /unsubscribe link always returns a clean confirmation. */
export const unsubscribeByEmail = internalMutation({
  args: { email: v.string(), nowMs: v.optional(v.number()) },
  handler: async (ctx, { email, nowMs }) => {
    const norm = email.trim().toLowerCase();
    const row = await ctx.db
      .query("subscribers")
      .withIndex("by_email", (q) => q.eq("email", norm))
      .first();
    if (row && row.status !== "unsubscribed") {
      await ctx.db.patch(row._id, { status: "unsubscribed", unsubscribedAt: nowMs ?? Date.now() });
    }
    return { ok: true };
  },
});
