import { action, internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { sendEmail } from "./lib/email";
import { betaWelcomeHtml, betaWelcomeSubject } from "./lib/emailTemplates/betaWelcome";

/* ============================================================
   Converting an EXISTING studio onto the beta programme.

   Distinct from betaAccess.claim, which builds a brand new workspace
   from an invite code. This one takes a studio that already exists -
   real owner, real Clerk org, real bookings - and grants it the beta
   licence in place.

   Nothing is created. No second workspace, no second account, no
   second login. A studio that already has a slug keeps it, which is
   the whole point: the alternative is a duplicate the owner has to
   choose between.
   ============================================================ */

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const _orgByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const needle = email.trim().toLowerCase();
    const org = (await ctx.db.query("orgs").collect()).find(
      (o) => (o.ownerEmail ?? "").toLowerCase() === needle,
    );
    if (!org) return null;
    return {
      orgId: org.orgId,
      name: org.name,
      slug: org.slug,
      ownerName: org.ownerName ?? null,
      ownerEmail: org.ownerEmail ?? null,
      betaCohort: org.betaCohort === true,
      betaLicenseUntil: org.betaLicenseUntil ?? null,
      betaWelcomeSentAt: org.betaWelcomeSentAt ?? null,
      onboardingCompletedAt: org.onboardingCompletedAt ?? null,
    };
  },
});

/**
 * Grant the beta licence to an existing studio.
 *
 * Idempotent on purpose: running it twice must not extend the licence by
 * another year or re-send the welcome. `force` re-dates it deliberately.
 */
export const _grant = internalMutation({
  args: {
    orgId: v.string(),
    months: v.optional(v.number()),
    tier: v.optional(v.union(v.literal("studio"), v.literal("pro"), v.literal("label"))),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, months, tier, force }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new ConvexError(`No studio with orgId ${orgId}`);

    if (org.betaCohort && org.betaLicenseUntil && !force) {
      return {
        changed: false as const,
        reason: "already_granted" as const,
        until: org.betaLicenseUntil,
      };
    }

    const now = Date.now();
    const until = months ? now + months * 30 * 24 * 60 * 60 * 1000 : now + YEAR_MS;

    await ctx.db.patch(org._id, {
      betaCohort: true,
      betaLicenseUntil: until,
      // A visible, honest countdown. The plan these studios sit on has
      // requireCardAfterTrial false, so this shows the end date without ever
      // locking anyone out of a studio they are actively running.
      billingStatus: "trialing",
      trialStartedAt: org.trialStartedAt ?? now,
      trialEndsAt: until,
      ...(tier ? { tier } : {}),
    });

    /*
     * Put them in the beta queue as well as badging the workspace.
     *
     * The dashboard at /agency/beta reads betaInvites, so a studio converted
     * in place would carry the Beta badge on the sub-account list and yet be
     * missing from the cohort you actually manage. It goes in as "claimed"
     * because that is true: the workspace exists and is theirs. No code is
     * issued - they already have a login, and a code would only invite them
     * to create the duplicate this whole path exists to avoid.
     */
    const existingInvite = (
      await ctx.db
        .query("betaInvites")
        .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
        .collect()
    )[0];
    if (!existingInvite && org.ownerEmail) {
      await ctx.db.insert("betaInvites", {
        agencyId: org.agencyId,
        email: org.ownerEmail.toLowerCase(),
        name: org.ownerName ?? undefined,
        company: org.name,
        // Marks the row as a conversion rather than an issued code. Not usable
        // as an access code: the gate normalizes and matches exactly, and this
        // shape can never be typed in by accident.
        code: `CONVERTED-${orgId.slice(-8).toUpperCase()}`,
        status: "claimed",
        ndaVersion: "converted",
        viewCount: 0,
        claimedOrgId: orgId,
        claimedSlug: org.slug,
        claimedAt: now,
        note: `Existing studio converted to the beta programme on ${new Date(now).toISOString().slice(0, 10)}`,
        createdAt: now,
      });
    }

    await ctx.db.insert("activity", {
      orgId,
      kind: "account.beta_granted",
      summary: `Beta licence granted to ${org.name} through ${new Date(until).toISOString().slice(0, 10)}`,
      accent: "gold",
    });
    return { changed: true as const, until, name: org.name, slug: org.slug };
  },
});

export const _markWelcomeSent = internalMutation({
  args: { orgId: v.string(), status: v.string() },
  handler: async (ctx, { orgId, status }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return;
    await ctx.db.patch(org._id, { betaWelcomeSentAt: Date.now() });
    await ctx.db.insert("activity", {
      orgId,
      kind: "account.beta_welcomed",
      summary: `Beta welcome email ${status} to ${org.ownerEmail ?? "the owner"}`,
      accent: "gold",
    });
  },
});

/**
 * Convert one existing studio by owner email, and send them back to the setup
 * they never finished.
 *
 * Run from the CLI. Deliberately not client-callable and deliberately not a
 * bulk operation: granting a year of free software to somebody is a decision
 * made one studio at a time.
 */
export const convertExisting = action({
  args: {
    email: v.string(),
    months: v.optional(v.number()),
    tier: v.optional(v.union(v.literal("studio"), v.literal("pro"), v.literal("label"))),
    send: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    orgId: string; name: string; until: number | null;
    granted: boolean; emailStatus: string;
  }> => {
    const found = await ctx.runQuery(internal.betaLicense._orgByEmail, { email: args.email });
    if (!found) throw new ConvexError(`No studio found with owner email ${args.email}`);

    const grant = await ctx.runMutation(internal.betaLicense._grant, {
      orgId: found.orgId,
      months: args.months,
      tier: args.tier,
      force: args.force,
    });

    // Send once. Re-running the conversion must not re-mail somebody.
    let emailStatus = "skipped";
    const alreadyWelcomed = Boolean(found.betaWelcomeSentAt);
    if (args.send !== false && !alreadyWelcomed) {
      const base = process.env.APP_URL ?? "https://studiopulse.tech";
      const until = grant.changed ? grant.until : found.betaLicenseUntil ?? Date.now();
      emailStatus = await sendEmail({
        to: found.ownerEmail ?? args.email,
        subject: betaWelcomeSubject(found.name),
        html: betaWelcomeHtml({
          ownerName: found.ownerName ?? undefined,
          studioName: found.name,
          welcomeUrl: `${base}/welcome`,
          untilLabel: new Date(until).toLocaleDateString("en-US", {
            year: "numeric", month: "long", day: "numeric",
          }),
        }),
      });
      await ctx.runMutation(internal.betaLicense._markWelcomeSent, {
        orgId: found.orgId,
        status: emailStatus,
      });
    }

    return {
      orgId: found.orgId,
      name: found.name,
      until: grant.changed ? grant.until : found.betaLicenseUntil,
      granted: grant.changed,
      emailStatus: alreadyWelcomed ? "already_sent" : emailStatus,
    };
  },
});
