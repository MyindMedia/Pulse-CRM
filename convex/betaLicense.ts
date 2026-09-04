import { action, internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { sendEmail } from "./lib/email";
import { betaWelcomeHtml, betaWelcomeSubject } from "./lib/emailTemplates/betaWelcome";
import { NDA_VERSION } from "./lib/betaNda";
import { requireCapability } from "./lib/access";
import { allowClerkIdentifier } from "./lib/clerkAllowlist";
import { BETA_TIER } from "./lib/plans";
import { defaultAgencyPlanId } from "./lib/betaPlan";

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

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A readable code for a converted studio. Random, not derived from the org
 *  id, so knowing a workspace tells you nothing about its code. */
function makeConversionCode(_orgId: string): string {
  const hex = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += CODE_ALPHABET[parseInt(hex.slice(i * 3, i * 3 + 3), 16) % CODE_ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

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

/** Replace a placeholder conversion code with a real random one, and make sure
 *  the row is on the current agreement version. Idempotent: a code that is
 *  already real is left alone, and a signature is never touched. */
export const _ensureSigningCode = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const inv = await ctx.db
      .query("betaInvites")
      .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
      .first();
    if (!inv) return { code: null as string | null, reissued: false };

    const placeholder = inv.code.startsWith("CONVERTED-");
    const code = placeholder ? makeConversionCode(orgId) : inv.code;
    if (placeholder || inv.ndaVersion === "converted") {
      await ctx.db.patch(inv._id, {
        code,
        // They were converted before the agreement was part of this path, so
        // point them at the current version rather than a placeholder string.
        ...(inv.signedAt ? {} : { ndaVersion: NDA_VERSION }),
      });
    }
    return { code, reissued: placeholder };
  },
});

/** The signing code and signature state for a converted studio. */
export const _inviteForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const inv = await ctx.db
      .query("betaInvites")
      .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
      .first();
    if (!inv) return null;
    return { code: inv.code, signedAt: inv.signedAt ?? null, signedName: inv.signedName ?? null };
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

    if (org.betaCohort && !force) {
      return {
        changed: false as const,
        reason: "already_granted" as const,
        until: org.betaLicenseUntil ?? null,
      };
    }

    const now = Date.now();

    /* The grant does NOT start the clock.
    
       The year begins on their first sign-in after signing the agreement
       (see betaClock.startIfNeeded). Starting it here charged a studio for
       the days between the agency granting the licence and the owner
       actually reading the agreement and getting in - which for a studio
       that took three weeks to respond was three weeks of a year they never
       had. betaLicenseUntil stays undefined until then, and the gate reads
       that as "granted, not started". */
    /* Label unless the agency says otherwise: the beta exists to be
       evaluated, and half a product is not one. And onto the Beta plan, so
       the gate has a countdown to run and a plan to convert at the end. */
    const betaPlanId = org.agencyPlanId ?? (await defaultAgencyPlanId(ctx, org.agencyId));
    await ctx.db.patch(org._id, {
      betaCohort: true,
      betaMonths: months,
      billingStatus: "trialing",
      trialStartedAt: org.trialStartedAt ?? now,
      tier: tier ?? BETA_TIER,
      ...(betaPlanId ? { agencyPlanId: betaPlanId } : {}),
      ...(force ? { betaLicenseUntil: undefined, betaStartedAt: undefined } : {}),
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
    const code = makeConversionCode(orgId);
    if (!existingInvite && org.ownerEmail) {
      await ctx.db.insert("betaInvites", {
        agencyId: org.agencyId,
        email: org.ownerEmail.toLowerCase(),
        name: org.ownerName ?? undefined,
        company: org.name,
        // A REAL code, because they still have to sign the agreement and the
        // signing page is reached by code. It cannot produce a duplicate
        // studio: claimedOrgId is set below, so the preview offers "open your
        // studio" rather than "build one".
        code,
        status: "claimed",
        ndaVersion: NDA_VERSION,
        viewCount: 0,
        claimedOrgId: orgId,
        claimedSlug: org.slug,
        claimedAt: now,
        note: `Existing studio converted to the beta programme on ${new Date(now).toISOString().slice(0, 10)}`,
        createdAt: now,
      });
    }

    const monthsLabel = months ?? 12;
    await ctx.db.insert("activity", {
      orgId,
      kind: "account.beta_granted",
      summary:
        `Beta licence granted to ${org.name}: ${monthsLabel} months, ` +
        `starting on their first sign-in after signing`,
      accent: "gold",
    });
    return {
      changed: true as const, until: null, name: org.name, slug: org.slug,
      code: existingInvite?.code ?? code,
    };
  },
});

/* Bring the cohort that predates the rule onto it.

   Every beta studio runs on Label and bills against the Beta plan. The ones
   granted before that was decided are on Pro, and one of them has no plan row
   at all - which reads as "no_plan" at the gate, so no countdown, no warnings
   and nothing to convert at the end of the year.

   Dates are not touched. A studio whose year has started keeps its start; one
   that has not signed stays unstarted. Idempotent, and dry by default. */
export const _normalizeCohort = internalMutation({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }) => {
    const orgs = await ctx.db.query("orgs").collect();
    const changes: { org: string; tier?: string; plan?: string; billing?: string }[] = [];

    for (const org of orgs) {
      if (!org.betaCohort || org.graduatedAt) continue;

      const patch: Record<string, unknown> = {};
      const change: { org: string; tier?: string; plan?: string; billing?: string } = {
        org: org.name,
      };

      if (org.tier !== BETA_TIER) {
        patch.tier = BETA_TIER;
        change.tier = `${org.tier ?? "none"} -> ${BETA_TIER}`;
      }
      if (!org.agencyPlanId) {
        const planId = await defaultAgencyPlanId(ctx, org.agencyId);
        if (planId) {
          patch.agencyPlanId = planId;
          const plan = await ctx.db.get(planId);
          change.plan = `none -> ${plan?.name ?? "default"}`;
        }
      }
      if (org.billingStatus !== "trialing" && org.billingStatus !== "active") {
        patch.billingStatus = "trialing";
        change.billing = `${org.billingStatus ?? "none"} -> trialing`;
      }

      if (Object.keys(patch).length === 0) continue;
      changes.push(change);
      if (apply) await ctx.db.patch(org._id, patch);
    }

    return { applied: Boolean(apply), changes };
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
type ConvertResult = {
  orgId: string; name: string; until: number | null;
  granted: boolean; emailStatus: string; signed: boolean;
};

/* Authorization lives on the wrapper below.

   This used to be a single PUBLIC action with no caller check at all. The
   Convex deployment URL ships in the client bundle, so anyone who guessed a
   studio owner's email could hand that studio a free year and fire a Pulse
   email at them. Granting a licence to somebody else's workspace is an
   agency act; it now takes an agency capability, and ops/CLI runs use the
   internal action directly. */
export const _convert = internalAction({
  args: {
    email: v.string(),
    months: v.optional(v.number()),
    tier: v.optional(v.union(v.literal("studio"), v.literal("pro"), v.literal("label"))),
    send: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
    /** Send again even if a welcome already went out. For the studios
     *  converted before the agreement was part of this flow. */
    resend: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ConvertResult> => {
    const found = await ctx.runQuery(internal.betaLicense._orgByEmail, { email: args.email });
    if (!found) throw new ConvexError(`No studio found with owner email ${args.email}`);

    const grant = await ctx.runMutation(internal.betaLicense._grant, {
      orgId: found.orgId,
      months: args.months,
      tier: args.tier,
      force: args.force,
    });

    /* Same gate as a fresh invite: the owner of a converted studio still has
       to be able to create a login. Playback signed nothing for a day because
       this step did not exist. */
    await allowClerkIdentifier(found.ownerEmail ?? args.email);

    // Send once. Re-running the conversion must not re-mail somebody.
    // Make sure they have a real code to sign against before anything is sent.
    await ctx.runMutation(internal.betaLicense._ensureSigningCode, {
      orgId: found.orgId,
    });

    let emailStatus = "skipped";
    const alreadyWelcomed = Boolean(found.betaWelcomeSentAt) && args.resend !== true;
    if (args.send !== false && !alreadyWelcomed) {
      const base = process.env.APP_URL ?? "https://studiopulse.tech";
      // Null until they start it by signing in. The template then sells the
      // length rather than inventing a date.
      const until = grant.changed ? grant.until : found.betaLicenseUntil;
      const inv = await ctx.runQuery(internal.betaLicense._inviteForOrg, {
        orgId: found.orgId,
      });
      // Send them to the agreement first. Everyone on the beta signs it, and
      // an existing customer being converted is no exception - they are about
      // to be shown an unreleased roadmap like everybody else.
      const signUrl = inv?.code
        ? `${base}/preview?code=${encodeURIComponent(inv.code)}`
        : `${base}/welcome`;
      emailStatus = await sendEmail({
        to: found.ownerEmail ?? args.email,
        subject: betaWelcomeSubject(found.name),
        html: betaWelcomeHtml({
          ownerName: found.ownerName ?? undefined,
          studioName: found.name,
          welcomeUrl: signUrl,
          needsSignature: !inv?.signedAt,
          monthsLabel: args.months ?? 12,
          untilLabel: until
            ? new Date(until).toLocaleDateString("en-US", {
                year: "numeric", month: "long", day: "numeric",
              })
            : undefined,
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
      signed: Boolean(
        (await ctx.runQuery(internal.betaLicense._inviteForOrg, { orgId: found.orgId }))?.signedAt,
      ),
    };
  },
});

/** Agency console entry point: same conversion, gated on the caller actually
 *  being an agency member over that studio. */
export const convertExisting = action({
  args: {
    email: v.string(),
    months: v.optional(v.number()),
    tier: v.optional(v.union(v.literal("studio"), v.literal("pro"), v.literal("label"))),
    send: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
    resend: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ConvertResult> => {
    const found = await ctx.runQuery(internal.betaLicense._orgByEmail, { email: args.email });
    if (!found) throw new ConvexError(`No studio found with owner email ${args.email}`);
    await ctx.runQuery(internal.betaLicense._assertCanConvert, { orgId: found.orgId });
    return await ctx.runAction(internal.betaLicense._convert, args);
  },
});

export const _assertCanConvert = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    return null;
  },
});
