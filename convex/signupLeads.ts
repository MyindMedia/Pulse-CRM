import { action, query, internalAction, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizeEmail, validEmail } from "./lib/emailKey";
import { resolveViewer } from "./lib/access";
import { platformAgencyId } from "./lib/platformAgency";
import {
  leadConsent, newLeadToken, nextNudgeAt, reminderLiveFlag, validLeadToken,
  LEAD_MAX_AGE_MS, LEAD_RETENTION_MS, NUDGE_OFFSETS,
} from "./lib/signupLeads";
import { signupNudgeHtml, signupNudgeSubject } from "./lib/emailTemplates/signupNudge";
import { sendEmail } from "./lib/email";
import { PRICING, PLATFORM_TRIAL_DAYS } from "./lib/pricing";
import { createSignupCheckout } from "./billing";
import type { TierKey } from "./lib/plans";

/* ============================================================
   Signup leads. "Start free trial" asks for an email first and saves the
   person here before Stripe Checkout opens, because a checkout left open
   is otherwise the last Pulse ever hears of them (the hosted page has the
   email, we do not).

   Someone who does not finish gets up to three reminders (1 hour, day 1,
   day 4) with a link that opens a fresh checkout. Reminders follow the
   consent recorded at the start, stop the moment the lead converts or
   unsubscribes, never reach a lead older than a week, and are off entirely
   until TRIAL_NUDGES_LIVE=true is set on the deployment.
   ============================================================ */

const MAX_NAME = 120;
const MAX_EMAIL = 254;

/** Every lead row for one address, newest first. */
async function leadsFor(ctx: MutationCtx, email: string) {
  const rows = await ctx.db
    .query("signupLeads")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** Internal - save (or restart) the lead for a trial start. */
export const _start = internalMutation({
  args: {
    email: v.string(),
    studioName: v.string(),
    tier: v.string(),
    interval: v.string(),
    optedIn: v.boolean(),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ leadId: string; email: string; studioName: string }> => {
    const email = normalizeEmail(args.email);
    if (email.length > MAX_EMAIL || !validEmail(email)) {
      throw new Error("Enter a valid email address.");
    }
    const studioName = args.studioName.trim().slice(0, MAX_NAME);
    const country = (args.country ?? "").trim().toUpperCase();
    const countryCode = /^[A-Z]{2}$/.test(country) ? country : undefined;
    const consent = leadConsent(countryCode, args.optedIn);
    const now = Date.now();

    const rows = await leadsFor(ctx, email);
    // Once someone says stop, no later start turns the reminders back on.
    const unsubscribed = rows.some((r) => r.unsubscribedAt !== undefined);
    const status = unsubscribed ? ("unsubscribed" as const) : ("open" as const);
    const canMail = status === "open" && consent !== "none";

    const reusable = rows.find((r) => r.status !== "converted");
    if (reusable) {
      /* A new start restarts the clock but never the count: anyone can type
         anyone's address into a public form, so starting again must not
         become a way to mail somebody every hour. Three reminders per
         address, ever. */
      const nudgeAt = canMail ? nextNudgeAt(now, reusable.nudgesSent) : undefined;
      await ctx.db.patch(reusable._id, {
        studioName: studioName || reusable.studioName,
        tier: args.tier,
        interval: args.interval,
        consent,
        country: countryCode,
        status,
        startedAt: now,
        startCount: reusable.startCount + 1,
        nextNudgeAt: nudgeAt,
      });
      return { leadId: reusable._id, email, studioName: studioName || reusable.studioName };
    }
    const leadId = await ctx.db.insert("signupLeads", {
      email,
      studioName,
      tier: args.tier,
      interval: args.interval,
      consent,
      country: countryCode,
      status,
      token: newLeadToken(),
      startedAt: now,
      startCount: 1,
      nudgesSent: 0,
      nextNudgeAt: canMail ? nextNudgeAt(now, 0) : undefined,
      createdAt: now,
      ...(unsubscribed ? { unsubscribedAt: now } : {}),
    });
    return { leadId, email, studioName };
  },
});

/** Internal - remember which checkout session belongs to the lead. */
export const _setSession = internalMutation({
  args: { leadId: v.id("signupLeads"), sessionId: v.string() },
  handler: async (ctx, { leadId, sessionId }) => {
    const lead = await ctx.db.get(leadId);
    if (lead) await ctx.db.patch(leadId, { lastSessionId: sessionId });
  },
});

/** Close the lead for a completed pay-first checkout: by the lead id the
 *  session carried, else by the email it was paid with. Called from the
 *  Stripe webhook. */
export async function markLeadConverted(
  ctx: MutationCtx,
  args: { leadId?: string; email?: string },
): Promise<void> {
  const now = Date.now();
  const id = args.leadId ? ctx.db.normalizeId("signupLeads", args.leadId) : null;
  const byId = id ? await ctx.db.get(id) : null;
  const email = normalizeEmail(args.email);
  const rows = email ? await leadsFor(ctx, email) : [];
  for (const lead of [byId, ...rows]) {
    if (!lead || lead.status === "converted") continue;
    await ctx.db.patch(lead._id, { status: "converted", convertedAt: now, nextNudgeAt: undefined });
  }
}

/** Internal - read a lead by its link token. */
export const _byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Doc<"signupLeads"> | null> => {
    if (!validLeadToken(token)) return null;
    return await ctx.db
      .query("signupLeads")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
  },
});

export const _markResumed = internalMutation({
  args: { leadId: v.id("signupLeads"), sessionId: v.string() },
  handler: async (ctx, { leadId, sessionId }) => {
    await ctx.db.patch(leadId, { resumedAt: Date.now(), lastSessionId: sessionId });
  },
});

/** Public - the "Finish setting up" link in a reminder: a fresh checkout for
 *  the lead's plan with their email already filled in. */
export const resume = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<
    { ok: true; checkoutUrl: string } | { ok: false; reason: "not_found" | "converted" }
  > => {
    const lead = await ctx.runQuery(internal.signupLeads._byToken, { token });
    if (!lead) return { ok: false, reason: "not_found" };
    if (lead.status === "converted") return { ok: false, reason: "converted" };
    const out = await createSignupCheckout({
      tier: lead.tier as TierKey,
      interval: lead.interval === "year" ? "year" : "month",
      email: lead.email,
      studioName: lead.studioName,
      leadId: lead._id,
    });
    if (!out.checkoutUrl) return { ok: false, reason: "not_found" };
    await ctx.runMutation(internal.signupLeads._markResumed, {
      leadId: lead._id,
      sessionId: out.sessionId,
    });
    return { ok: true, checkoutUrl: out.checkoutUrl };
  },
});

async function unsubscribeToken(ctx: MutationCtx, token: string): Promise<boolean> {
  if (!validLeadToken(token)) return false;
  const lead = await ctx.db
    .query("signupLeads")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!lead) return false;
  const now = Date.now();
  // Every row for the address, so an older or newer start cannot keep mailing.
  for (const row of await leadsFor(ctx, lead.email)) {
    if (row.unsubscribedAt !== undefined) continue;
    await ctx.db.patch(row._id, {
      unsubscribedAt: now,
      nextNudgeAt: undefined,
      ...(row.status === "converted" ? {} : { status: "unsubscribed" as const }),
    });
  }
  return true;
}

/** Public - the "Stop these emails" page. Idempotent. */
export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => ({ ok: await unsubscribeToken(ctx, token) }),
});

/** Internal - the RFC 8058 one-click POST (convex/http.ts). */
export const _unsubscribe = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => ({ ok: await unsubscribeToken(ctx, token) }),
});

type DueNudge = {
  leadId: Id<"signupLeads">;
  step: number;
  email: string;
  studioName: string;
  tier: string;
  token: string;
};

/** Internal - claim the reminders that are due, advancing each lead before the
 *  email goes so a retried sweep cannot send the same reminder twice. Also
 *  retires leads past the reminder window and deletes old unconverted ones. */
export const _claimDue = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<DueNudge[]> => {
    const now = args.now ?? Date.now();
    const due = await ctx.db
      .query("signupLeads")
      .withIndex("by_status_next", (q) =>
        q.eq("status", "open").gt("nextNudgeAt", 0).lte("nextNudgeAt", now),
      )
      .take(100);
    const out: DueNudge[] = [];
    for (const lead of due) {
      if (lead.consent === "none" || lead.unsubscribedAt !== undefined) {
        await ctx.db.patch(lead._id, { nextNudgeAt: undefined });
        continue;
      }
      if (now - lead.startedAt > LEAD_MAX_AGE_MS) {
        await ctx.db.patch(lead._id, { status: "stale", nextNudgeAt: undefined });
        continue;
      }
      const step = lead.nudgesSent;
      if (step >= NUDGE_OFFSETS.length) {
        await ctx.db.patch(lead._id, { nextNudgeAt: undefined });
        continue;
      }
      await ctx.db.patch(lead._id, {
        nudgesSent: step + 1,
        lastNudgeAt: now,
        nextNudgeAt: nextNudgeAt(lead.startedAt, step + 1),
      });
      out.push({
        leadId: lead._id,
        step,
        email: lead.email,
        studioName: lead.studioName,
        tier: lead.tier,
        token: lead.token,
      });
    }

    // Retention: an unconverted lead is deleted half a year after its last start.
    const old = await ctx.db
      .query("signupLeads")
      .withIndex("by_created", (q) => q.lt("createdAt", now - LEAD_RETENTION_MS))
      .take(50);
    for (const lead of old) {
      if (lead.status !== "converted" && now - lead.startedAt > LEAD_RETENTION_MS) {
        await ctx.db.delete(lead._id);
      }
    }
    return out;
  },
});

function links(token: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://studiopulse.tech").replace(/\/$/, "");
  const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");
  return {
    resumeUrl: `${base}/start/${token}`,
    unsubscribeUrl: `${base}/unsubscribe/${token}`,
    oneClickUrl: site ? `${site}/signup/unsubscribe?t=${token}` : `${base}/unsubscribe/${token}`,
    demoUrl: `${base}/demo`,
  };
}

/** The reminder for one lead and step, as it would be sent. Shared by the
 *  sweep and the owner's sample send. */
export function renderNudge(n: { step: number; studioName: string; tier: string; token: string }) {
  const l = links(n.token);
  const tierName = PRICING[n.tier as TierKey]?.name ?? "Pulse";
  return {
    subject: signupNudgeSubject(n.step, n.studioName),
    html: signupNudgeHtml({
      step: n.step,
      studioName: n.studioName,
      tierName,
      trialDays: PLATFORM_TRIAL_DAYS,
      resumeUrl: l.resumeUrl,
      unsubscribeUrl: l.unsubscribeUrl,
      demoUrl: l.demoUrl,
    }),
    headers: {
      "List-Unsubscribe": `<${l.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** Internal (cron) - send the reminders that are due. Does nothing, and
 *  advances nothing, until TRIAL_NUDGES_LIVE=true. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ live: boolean; sent: number; failed: number }> => {
    if (!reminderLiveFlag()) return { live: false, sent: 0, failed: 0 };
    const due = await ctx.runMutation(internal.signupLeads._claimDue, {});
    let sent = 0;
    let failed = 0;
    for (const n of due) {
      const mail = renderNudge(n);
      const status = await sendEmail({ to: n.email, ...mail });
      if (status === "failed") {
        failed++;
        console.error("[signupLeads] reminder failed", { leadId: n.leadId, step: n.step });
      } else sent++;
    }
    return { live: true, sent, failed };
  },
});

/** Internal - email the owner one sample of each reminder (no lead touched). */
export const _sendSamples = internalAction({
  args: { to: v.string(), studioName: v.optional(v.string()), tier: v.optional(v.string()) },
  handler: async (_ctx, { to, studioName, tier }) => {
    const out: string[] = [];
    for (let step = 0; step < NUDGE_OFFSETS.length; step++) {
      const mail = renderNudge({
        step,
        studioName: studioName ?? "Blue Room Studios",
        tier: tier ?? "growth",
        token: "0".repeat(32),
      });
      out.push(await sendEmail({ to, ...mail, subject: `[Sample ${step + 1}/3] ${mail.subject}` }));
    }
    return out;
  },
});

/** Platform owner - the "Unfinished sign-ups" list. Empty for anyone else. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      items: [] as Array<Omit<Doc<"signupLeads">, "token">>,
      counts: { total: 0, open: 0, converted: 0, unsubscribed: 0, stale: 0, emailable: 0 },
      live: false,
    };
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member") return empty;
    const pulse = await platformAgencyId(ctx);
    if (!pulse || viewer.agencyId !== pulse) return empty;
    const rows = await ctx.db.query("signupLeads").withIndex("by_created").order("desc").take(500);
    // The token is the person's resume + unsubscribe link: it never leaves the server.
    const items = rows.map(({ token: _token, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    return {
      items,
      counts: {
        total: rows.length,
        open: rows.filter((r) => r.status === "open").length,
        converted: rows.filter((r) => r.status === "converted").length,
        unsubscribed: rows.filter((r) => r.status === "unsubscribed").length,
        stale: rows.filter((r) => r.status === "stale").length,
        emailable: rows.filter((r) => r.status === "open" && r.consent !== "none").length,
      },
      live: reminderLiveFlag(),
    };
  },
});
