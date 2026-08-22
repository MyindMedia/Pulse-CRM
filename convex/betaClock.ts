import { mutation, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { resolveViewer } from "./lib/access";
import { sendEmail } from "./lib/email";
import { betaEndingHtml, betaEndingSubject } from "./lib/emailTemplates/betaEnding";

/* ============================================================
   When the beta year actually runs.

   The licence is granted by the agency, but the year does not begin
   there. It begins the first time the owner signs in AFTER signing the
   agreement. Anything else charges a studio for the gap between an
   agency deciding to let them in and the owner reading the agreement -
   days they never had the product.

   So there are three states, and the difference matters:

     granted, not signed    - no clock, no countdown, nothing expires
     granted, not started   - same; they signed but have not been back
     running                - betaStartedAt + betaLicenseUntil are set

   The last one is written exactly once. `startIfNeeded` is safe to call
   on every page load and does nothing after the first success.
   ============================================================ */

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const DEFAULT_MONTHS = 12;

/** Days before the end at which a warning email goes out. */
export const WARNING_DAYS = [30, 7, 1];

/**
 * Start the beta year if this caller is a signed beta studio that has not
 * started one. Called from the app shell on load; a no-op almost always.
 */
export const startIfNeeded = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer?.orgId) return { started: false as const, reason: "no_org" as const };

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", viewer.orgId!))
      .first();
    if (!org?.betaCohort) return { started: false as const, reason: "not_beta" as const };
    if (org.graduatedAt) return { started: false as const, reason: "graduated" as const };
    if (org.betaLicenseUntil) {
      return { started: false as const, reason: "already_running" as const, until: org.betaLicenseUntil };
    }

    /* The signature is the gate. A studio that has not signed can look
       around, but the year they were promised has not begun - and starting
       it here would quietly spend their licence on the days they spent
       ignoring the agreement. */
    const invite = (
      await ctx.db
        .query("betaInvites")
        .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", org.orgId))
        .collect()
    )[0];
    if (!invite?.signedAt) {
      return { started: false as const, reason: "not_signed" as const };
    }

    const now = Date.now();
    const months = org.betaMonths ?? DEFAULT_MONTHS;
    const until = now + months * MONTH_MS;
    await ctx.db.patch(org._id, {
      betaStartedAt: now,
      betaLicenseUntil: until,
      trialStartedAt: now,
      trialEndsAt: until,
      betaWarningsSent: [],
    });
    await ctx.db.insert("activity", {
      orgId: org.orgId,
      kind: "beta.started",
      summary: `Beta year started for ${org.name}`,
      accent: "gold",
    });
    return { started: true as const, until };
  },
});

/* ── End-of-beta warnings ─────────────────────────────────────
   The lock at the end is not a surprise anyone should meet cold. A daily
   sweep mails at 30, 7 and 1 days out, each exactly once. */

export const _dueForWarning = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orgs = await ctx.db.query("orgs").collect();
    const due: { orgId: string; name: string; email: string; ownerName: string | null; daysLeft: number; mark: number; until: number }[] = [];
    for (const org of orgs) {
      if (!org.betaCohort || org.graduatedAt || !org.betaLicenseUntil) continue;
      if (org.billingStatus === "active") continue; // already subscribed
      if (!org.ownerEmail) continue;
      const daysLeft = Math.ceil((org.betaLicenseUntil - now) / DAY_MS);
      if (daysLeft < 0) continue;
      const sent = org.betaWarningsSent ?? [];
      // The largest threshold we have reached and not yet sent.
      const mark = WARNING_DAYS.find((d) => daysLeft <= d && !sent.includes(d));
      if (mark === undefined) continue;
      due.push({
        orgId: org.orgId,
        name: org.name,
        email: org.ownerEmail,
        ownerName: org.ownerName ?? null,
        daysLeft: Math.max(0, daysLeft),
        mark,
        until: org.betaLicenseUntil,
      });
    }
    return due;
  },
});

export const _markWarned = internalMutation({
  args: { orgId: v.string(), mark: v.number() },
  handler: async (ctx, { orgId, mark }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return;
    const sent = org.betaWarningsSent ?? [];
    if (sent.includes(mark)) return;
    await ctx.db.patch(org._id, { betaWarningsSent: [...sent, mark] });
  },
});

export const sweepWarnings = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const due = await ctx.runQuery(internal.betaClock._dueForWarning, {});
    const base = process.env.APP_URL ?? "https://studiopulse.tech";
    let sent = 0;
    for (const d of due) {
      const status = await sendEmail({
        to: d.email,
        subject: betaEndingSubject(d.name, d.daysLeft),
        html: betaEndingHtml({
          ownerName: d.ownerName ?? undefined,
          studioName: d.name,
          daysLeft: d.daysLeft,
          endsOnLabel: new Date(d.until).toLocaleDateString("en-US", {
            year: "numeric", month: "long", day: "numeric",
          }),
          chooseUrl: `${base}/settings?tab=billing`,
        }),
      });
      // Mark regardless of send status: a bounced address must not turn the
      // sweep into a daily retry loop against the same studio.
      await ctx.runMutation(internal.betaClock._markWarned, { orgId: d.orgId, mark: d.mark });
      if (status === "sent") sent++;
    }
    return { sent };
  },
});

/* ── One-time backfill ────────────────────────────────────────
   Studios granted before the clock moved to first-sign-in are carrying a
   date set at grant time. Two cases, and the difference is whether they
   ever agreed to anything:

     signed     - the year genuinely began when they signed, so re-date it
                  from there. Closest honest reading of the new rule for a
                  studio already using the product.
     not signed - the year has not begun. Clear the date and let their
                  first sign-in after signing start it, which is what they
                  were actually promised.

   Idempotent: a studio that already has betaStartedAt is left alone. */
export const _backfillStartDates = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }) => {
    const MONTH = 30 * DAY_MS;
    const orgs = await ctx.db.query("orgs").collect();
    const changes: { org: string; action: string; until: number | null }[] = [];
    for (const org of orgs) {
      if (!org.betaCohort || org.graduatedAt) continue;
      if (org.betaStartedAt) continue; // already on the new model

      const invite = (
        await ctx.db
          .query("betaInvites")
          .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", org.orgId))
          .collect()
      )[0];
      const months = org.betaMonths ?? DEFAULT_MONTHS;

      if (invite?.signedAt) {
        const until = invite.signedAt + months * MONTH;
        changes.push({ org: org.name, action: "re-dated from signature", until });
        if (apply) {
          await ctx.db.patch(org._id, {
            betaStartedAt: invite.signedAt,
            betaLicenseUntil: until,
            trialStartedAt: invite.signedAt,
            trialEndsAt: until,
            betaWarningsSent: org.betaWarningsSent ?? [],
          });
        }
      } else {
        changes.push({ org: org.name, action: "cleared - not signed yet", until: null });
        if (apply) {
          await ctx.db.patch(org._id, {
            betaLicenseUntil: undefined,
            trialEndsAt: undefined,
            betaWarningsSent: [],
          });
        }
      }
    }
    return { applied: Boolean(apply), changes };
  },
});
