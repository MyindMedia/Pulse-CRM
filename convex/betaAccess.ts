import { mutation, query, action, internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { requireCapability, resolveViewer } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { sendEmail } from "./lib/email";
import { betaInviteHtml, betaInviteSubject } from "./lib/emailTemplates/betaInvite";
import {
  NDA_VERSION, NDA_TITLE, NDA_INTRO, NDA_CLAUSES, NDA_TERMS_HASH,
} from "./lib/betaNda";
import { moduleBoard, MODULES } from "./lib/modules";
import { defaultAgencyPlanId } from "./lib/betaPlan";
import {
  PLAN_LIMITS, SELLABLE_TIERS, EARLY_ADOPTER_MONTHS, BETA_DEFAULT_MONTHS, BETA_TIER,
  priceLabel, earlyAdopterApplies, earlyAdopterPriceCents,
} from "./lib/plans";
import { ROADMAP, KIND_LABELS } from "./lib/roadmap";
import { allowClerkIdentifier } from "./lib/clerkAllowlist";

/* ============================================================
   Beta access.

   A named person gets a code. The code opens a gate; the gate opens
   only after they have signed the agreement. Both checks run on the
   SERVER: the preview content is fetched after signing, never shipped
   to the browser and hidden with CSS.

   Everything is attributed. One code per recipient means the agency
   sees who opened it, when, and who actually signed - which is the
   difference between a beta list and a mailing list.
   ============================================================ */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const CODE_LEN = 12;

/**
 * A readable, unguessable access code, unique to one invited person.
 *
 * Entropy comes from crypto.randomUUID(), NOT from a seed derived off the
 * recipient's email and a timestamp. That earlier approach was predictable:
 * anyone who knew an invitee's address could search a small timestamp space
 * and land on their code. Twelve characters from a 32-symbol alphabet is
 * about 60 bits, which makes guessing an unissued code infeasible rather
 * than merely inconvenient.
 *
 * Ambiguous characters (I, O, 0, 1) are left out because half of these get
 * read down a phone.
 */
function makeCode(): string {
  const hex = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    // 3 hex digits (12 bits) per output symbol keeps the modulo bias far
    // below the point where it would narrow the search space meaningfully.
    const chunk = parseInt(hex.slice(i * 3, i * 3 + 3), 16);
    out += CODE_ALPHABET[chunk % CODE_ALPHABET.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/* ── The agreement, for the gate to render ──────────────────── */

export const terms = query({
  args: {},
  handler: async () => ({
    version: NDA_VERSION,
    title: NDA_TITLE,
    intro: NDA_INTRO,
    clauses: NDA_CLAUSES,
    hash: NDA_TERMS_HASH,
  }),
});

/* ── Public gate ────────────────────────────────────────────── */

/**
 * PUBLIC. Is this code good, and has it been signed?
 *
 * Deliberately says as little as possible about a bad code: an attacker
 * guessing should not learn whether they got close.
 */
export const check = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();
    if (!invite) return { valid: false as const, reason: "unknown" as const };
    if (invite.status === "revoked") return { valid: false as const, reason: "revoked" as const };
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      return { valid: false as const, reason: "expired" as const };
    }
    return {
      valid: true as const,
      // Signed means signed. A converted studio can be claimed and unsigned,
      // which is exactly the case this distinction exists for.
      signed: Boolean(invite.signedAt),
      claimed: invite.status === "claimed",
      claimedSlug: invite.claimedSlug ?? null,
      suggestedName: invite.company ?? null,
      recipientName: invite.name ?? null,
      company: invite.company ?? null,
      // Only echoed once signed, so the record is visible to the person who
      // made it and to nobody else.
      signedName: invite.status === "signed" ? invite.signedName ?? null : null,
      signedAt: invite.status === "signed" ? invite.signedAt ?? null : null,
      ndaVersion: invite.ndaVersion,
      staleTerms: invite.status === "signed" && invite.ndaVersion !== NDA_VERSION,
    };
  },
});

/** PUBLIC. Record that the code was opened. Attribution, not authorization. */
export const recordView = mutation({
  args: {
    code: v.string(),
    // True when they arrived on the magic link rather than typing the code.
    viaLink: v.optional(v.boolean()),
  },
  handler: async (ctx, { code, viaLink }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();
    if (!invite || invite.status === "revoked") return { ok: false };
    const now = Date.now();
    await ctx.db.patch(invite._id, {
      viewCount: invite.viewCount + 1,
      firstViewedAt: invite.firstViewedAt ?? now,
      lastViewedAt: now,
      ...(viaLink
        ? {
            clickedAt: invite.clickedAt ?? now,
            clickCount: (invite.clickCount ?? 0) + 1,
          }
        : {}),
      // Never walk the funnel backwards: a signed or claimed invite that gets
      // opened again is still signed or claimed.
      status:
        invite.status === "signed" || invite.status === "claimed"
          ? invite.status
          : "viewed",
    });
    return { ok: true };
  },
});

/**
 * PUBLIC. Sign the agreement.
 *
 * Binds the signature to the exact terms text the person was shown, so a
 * later edit cannot be passed off as what they agreed to.
 */
export const sign = mutation({
  args: {
    code: v.string(),
    signedName: v.string(),
    signedTitle: v.optional(v.string()),
    signedCompany: v.optional(v.string()),
    termsHash: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(args.code)))
      .first();
    if (!invite) throw new ConvexError({ code: "BAD_CODE", message: "That access code is not valid." });
    if (invite.status === "revoked") {
      throw new ConvexError({ code: "REVOKED", message: "That access code has been withdrawn." });
    }
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      throw new ConvexError({ code: "EXPIRED", message: "That access code has expired." });
    }
    const name = args.signedName.trim();
    // A signature is a person's name. Two characters is not one.
    if (name.length < 2) {
      throw new ConvexError({ code: "NAME_REQUIRED", message: "Type your full name to sign." });
    }
    if (args.termsHash !== NDA_TERMS_HASH) {
      // The page was open while the terms changed underneath it.
      throw new ConvexError({
        code: "TERMS_CHANGED",
        message: "These terms were updated. Reload the page and read them again before signing.",
      });
    }

    await ctx.db.patch(invite._id, {
      // A studio converted in place is already "claimed" - it has a real
      // workspace. Signing must not walk that backwards, so status only
      // advances. signedAt is the source of truth for whether they signed.
      status: invite.status === "claimed" ? "claimed" : "signed",
      signedName: name.slice(0, 120),
      signedTitle: args.signedTitle?.trim().slice(0, 120) || undefined,
      signedCompany: args.signedCompany?.trim().slice(0, 160) || invite.company,
      signedAt: Date.now(),
      signedTermsHash: args.termsHash,
      signedUserAgent: args.userAgent?.slice(0, 300),
      ndaVersion: NDA_VERSION,
    });
    return { ok: true, signedAt: Date.now() };
  },
});

/* ── Agency CRM ─────────────────────────────────────────────── */

/** Every invite this agency has issued, with where each one has got to. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer || viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
      return { items: [], counts: { total: 0, sent: 0, viewed: 0, signed: 0, revoked: 0 } };
    }
    const rows = await ctx.db
      .query("betaInvites")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    const items = rows.sort((a, b) => b.createdAt - a.createdAt);
    const live = rows.filter((r) => r.status !== "revoked");

    // A funnel, not a set of independent counts: each stage counts everyone
    // who reached it OR went past it, so the numbers only ever go down and
    // the drop between two stages is the thing worth looking at.
    const sent = live.filter((r) => Boolean(r.sentAt)).length;
    const opened = live.filter((r) => r.viewCount > 0).length;
    const clicked = live.filter((r) => Boolean(r.clickedAt)).length;
    const signed = live.filter((r) => Boolean(r.signedAt)).length;
    const claimed = live.filter((r) => r.status === "claimed").length;

    const signedRows = live.filter((r) => Boolean(r.signedAt));
    const rate = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

    return {
      items,
      counts: {
        total: rows.length,
        sent,
        opened,
        clicked,
        signed,
        claimed,
        revoked: rows.filter((r) => r.status === "revoked").length,
        // Awaiting a nudge: the email went, nothing came back.
        silent: live.filter((r) => Boolean(r.sentAt) && r.viewCount === 0).length,
        // Read the terms and stopped. The most useful list on the page.
        stalled: live.filter((r) => r.viewCount > 0 && !r.signedAt).length,
        // Has a workspace and a licence, but has not signed the agreement.
        // They are already using the product, so this list is the one that
        // needs chasing rather than ignoring.
        unsigned: live.filter((r) => r.status === "claimed" && !r.signedAt).length,
      },
      rates: {
        openRate: rate(opened, sent),
        signRate: rate(signed, opened),
        claimRate: rate(claimed, signed),
        endToEnd: rate(claimed, sent),
      },
      // The signature register: who agreed to what, and when.
      signatures: signedRows
        .sort((a, b) => (b.signedAt ?? 0) - (a.signedAt ?? 0))
        .map((r) => ({
          id: r._id,
          name: r.signedName ?? r.name ?? r.email,
          title: r.signedTitle ?? null,
          company: r.signedCompany ?? r.company ?? null,
          email: r.email,
          signedAt: r.signedAt ?? 0,
          ndaVersion: r.ndaVersion,
          termsHash: r.signedTermsHash ?? null,
          staleTerms: r.ndaVersion !== NDA_VERSION,
        })),
      currentNdaVersion: NDA_VERSION,
    };
  },
});

export const _create = internalMutation({
  args: {
    agencyId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    note: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new ConvexError("That is not an email address.");

    // One live code per person: re-inviting someone reuses their row rather
    // than leaving two codes that both work.
    const existing = (await ctx.db
      .query("betaInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect()).find((r) => r.agencyId === args.agencyId && r.status !== "revoked");
    if (existing) return { id: existing._id, code: existing.code, reused: true };

    const now = Date.now();
    // One code, one person. Re-rolled on the vanishingly unlikely collision so
    // two invitees can never share an identity.
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("betaInvites")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!clash) break;
      code = makeCode();
    }

    const id = await ctx.db.insert("betaInvites", {
      agencyId: args.agencyId,
      email,
      name: args.name?.trim() || undefined,
      company: args.company?.trim() || undefined,
      code,
      status: "created",
      ndaVersion: NDA_VERSION,
      viewCount: 0,
      note: args.note?.trim() || undefined,
      expiresAt: args.expiresInDays ? now + args.expiresInDays * 86_400_000 : undefined,
      createdBy: args.createdBy,
      createdAt: now,
    });
    return { id, code, reused: false };
  },
});

export const _markSent = internalMutation({
  args: { code: v.string(), emailStatus: v.string() },
  handler: async (ctx, { code, emailStatus }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!invite) return;
    await ctx.db.patch(invite._id, {
      status: invite.status === "created" ? "sent" : invite.status,
      sentAt: Date.now(),
      emailStatus,
    });
  },
});

/** Viewer resolution for the action path. Actions have no `db`, so they
 *  cannot call requireCapability directly - they resolve through a query the
 *  same way every other action in this codebase does. */
export const _self = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      const viewer = await resolveViewer(ctx);
      if (viewer.kind !== "agency_member") return null;
      return {
        agencyId: viewer.agencyId,
        clerkUserId: viewer.clerkUserId,
        canInvite: viewer.capabilities.has("agency.staff.invite"),
      };
    } catch {
      return null;
    }
  },
});

export const _agencyCtx = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) => {
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .first();
    return { name: ag?.name ?? "Myind Sound" };
  },
});

/** Create an invite and send the branded email. */
export const invite = action({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    note: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
    send: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ code: string; emailStatus: string; reused: boolean }> => {
    const self = await ctx.runQuery(internal.betaAccess._self, {});
    if (!self) throw new ConvexError("Agency users only.");
    if (!self.canInvite) throw new ConvexError("You cannot send beta invites.");

    const created = await ctx.runMutation(internal.betaAccess._create, {
      agencyId: self.agencyId,
      email: args.email,
      name: args.name,
      company: args.company,
      note: args.note,
      expiresInDays: args.expiresInDays,
      createdBy: self.clerkUserId,
    });

    /* Clerk's allowlist is on: an invited owner who is not on it cannot
       create an account, whatever the invite says. Do it even when the mail
       is suppressed - the code is still handed out by other means. */
    await allowClerkIdentifier(args.email);

    if (args.send === false) {
      return { code: created.code, emailStatus: "not_sent", reused: created.reused };
    }

    const ag = await ctx.runQuery(internal.betaAccess._agencyCtx, { agencyId: self.agencyId });
    const base = process.env.APP_URL ?? "https://studiopulse.tech";
    const accessUrl = `${base}/preview?code=${encodeURIComponent(created.code)}`;

    const emailStatus = await sendEmail({
      to: args.email.trim(),
      subject: betaInviteSubject(args.company),
      html: betaInviteHtml({
        recipientName: args.name,
        accessUrl,
        code: created.code,
        fromName: `${ag.name}`,
        expiresLabel: args.expiresInDays ? `${args.expiresInDays} days` : null,
        trackingOrigin: process.env.CONVEX_SITE_URL ?? null,
      }),
    });

    await ctx.runMutation(internal.betaAccess._markSent, {
      code: created.code,
      emailStatus,
    });
    return { code: created.code, emailStatus, reused: created.reused };
  },
});

export const revoke = mutation({
  args: { id: v.id("betaInvites") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new ConvexError("Agency users only.");
    const invite = await ctx.db.get(id);
    if (!invite || invite.agencyId !== viewer.agencyId) throw new ConvexError("Not found.");
    // Never delete: the signature record is the point of the whole thing.
    await ctx.db.patch(id, { status: "revoked" });
  },
});


/**
 * PUBLIC, but gated: the full preview content.
 *
 * The content is assembled on the SERVER and returned only to a code that has
 * actually signed. It is never shipped to the browser and hidden with CSS,
 * because "hidden" is one devtools panel away from "published", and the whole
 * point of the agreement is that this is not published.
 */
export const preview = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();

    const ok =
      invite &&
      Boolean(invite.signedAt) &&
      invite.status !== "revoked" &&
      (!invite.expiresAt || invite.expiresAt >= Date.now());
    if (!ok) return { unlocked: false as const };

    const board = moduleBoard();
    return {
      unlocked: true as const,
      signedName: invite.signedName ?? null,
      signedAt: invite.signedAt ?? null,
      // Watermark: every rendered page names the person it was opened by.
      // Not DRM, just the thing that makes a forwarded screenshot awkward.
      watermark: `${invite.signedName ?? invite.email} · ${invite.company ?? ""}`.trim(),
      counts: {
        modules: MODULES.length,
        areas: board.length,
        roadmap: ROADMAP.filter((r) => r.status !== "shipped").length,
      },
      /* What the beta becomes. A studio signing a year-long agreement is
         entitled to know the number it converts to, and the launch offer is
         only an offer if they are told about it before it closes. */
      betaTerms: {
        months: BETA_DEFAULT_MONTHS,
        introMonths: EARLY_ADOPTER_MONTHS,
        offerOpen: SELLABLE_TIERS.some((t) => earlyAdopterApplies(t, "month")),
      },
      tiers: SELLABLE_TIERS.map((t) => ({
        key: t,
        label: PLAN_LIMITS[t].label,
        price: priceLabel(t),
        intro: earlyAdopterApplies(t, "month")
          ? `$${(earlyAdopterPriceCents(t) / 100).toFixed(2)}`
          : null,
        pitch: PLAN_LIMITS[t].pitch,
      })),
      areas: board.map((g) => ({
        area: g.area,
        label: g.label,
        modules: g.modules.map((m) => ({
          key: m.key,
          label: m.label,
          blurb: m.blurb,
          tier: m.tier,
          tierLabel: m.tier ? PLAN_LIMITS[m.tier].label : null,
        })),
        alwaysOn: g.alwaysOn.map((a) => ({ id: a.id, label: a.label, blurb: a.blurb })),
      })),
      roadmap: ROADMAP.filter((r) => r.status !== "shipped").map((r) => ({
        ...r,
        kindLabel: KIND_LABELS[r.kind],
      })),
      shippedFromRoadmap: ROADMAP.filter((r) => r.status === "shipped").map((r) => ({
        id: r.id, title: r.title, kindLabel: KIND_LABELS[r.kind],
      })),
    };
  },
});


/* ── Claiming a studio ──────────────────────────────────────── */

export const _claimCtx = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();
    if (!invite) return null;
    return {
      id: invite._id,
      agencyId: invite.agencyId ?? null,
      email: invite.email,
      name: invite.name ?? invite.signedName ?? null,
      company: invite.signedCompany ?? invite.company ?? null,
      status: invite.status,
      claimedSlug: invite.claimedSlug ?? null,
      expired: Boolean(invite.expiresAt && invite.expiresAt < Date.now()),
    };
  },
});

export const _markClaimed = internalMutation({
  args: { code: v.string(), orgId: v.string(), slug: v.string() },
  handler: async (ctx, { code, orgId, slug }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();
    if (!invite) return;
    await ctx.db.patch(invite._id, {
      status: "claimed",
      claimedOrgId: orgId,
      claimedSlug: slug,
      claimedAt: Date.now(),
    });
  },
});

/** PUBLIC. Is this slug free? Checked as the recipient types it. */
export const slugAvailable = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (clean.length < 2) return { ok: false as const, reason: "too_short" as const, slug: clean };
    const taken = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", clean))
      .first();
    return taken
      ? { ok: false as const, reason: "taken" as const, slug: clean }
      : { ok: true as const, slug: clean };
  },
});

/**
 * Turn a signed invite into a real studio workspace.
 *
 * The end of the funnel: the recipient has read the terms, signed them, seen
 * the product, and now wants it. Requires a SIGNED invite - the agreement is
 * the price of admission, not an optional step you can navigate past.
 */
export const claim = action({
  args: {
    code: v.string(),
    studioName: v.string(),
    slug: v.string(),
    ownerName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ slug: string; orgId: string; inviteToken: string | null }> => {
    const ctxInvite = await ctx.runQuery(internal.betaAccess._claimCtx, { code: args.code });
    if (!ctxInvite) throw new ConvexError({ code: "BAD_CODE", message: "That access code is not valid." });
    if (ctxInvite.status === "revoked") {
      throw new ConvexError({ code: "REVOKED", message: "That access code has been withdrawn." });
    }
    if (ctxInvite.expired) {
      throw new ConvexError({ code: "EXPIRED", message: "That access code has expired." });
    }
    if (ctxInvite.status === "claimed") {
      throw new ConvexError({
        code: "ALREADY_CLAIMED",
        message: `You already have a studio at /${ctxInvite.claimedSlug}.`,
      });
    }
    if (ctxInvite.status !== "signed") {
      throw new ConvexError({
        code: "NOT_SIGNED",
        message: "Sign the agreement before creating your studio.",
      });
    }

    const name = args.studioName.trim();
    if (name.length < 2) {
      throw new ConvexError({ code: "NAME_REQUIRED", message: "Give your studio a name." });
    }

    const created = await ctx.runMutation(internal.betaAccess._provision, {
      agencyId: ctxInvite.agencyId ?? undefined,
      name,
      slug: args.slug,
      ownerName: args.ownerName?.trim() || ctxInvite.name || name,
      ownerEmail: ctxInvite.email,
      code: normalizeCode(args.code),
    });

    await ctx.runMutation(internal.betaAccess._markClaimed, {
      code: args.code,
      orgId: created.orgId,
      slug: created.slug,
    });

    /*
     * Mint an account-creation token and hand the recipient to the EXISTING
     * /invite flow rather than straight to /welcome.
     *
     * This is the bit that was broken: claiming created the workspace and the
     * owner's members row, but nothing linked that row to a Clerk user. The
     * access engine resolves a studio member by clerkUserId, so the person who
     * had just built the studio could not open it - /welcome threw and the
     * error boundary caught it.
     *
     * invites.accept already does the whole job: creates the Clerk user,
     * writes clerkUserId onto the members row matched by (orgId, email), and
     * routes owners to /welcome. Reusing it beats maintaining a second,
     * subtly different account-creation path.
     */
    let inviteToken: string | null = null;
    try {
      inviteToken = await ctx.runMutation(internal.invites.record, {
        orgId: created.orgId,
        agencyId: ctxInvite.agencyId ?? undefined,
        email: ctxInvite.email,
        ownerName: args.ownerName?.trim() || ctxInvite.name || name,
        studioName: name,
        invitedBy: "beta-claim",
        emailStatus: "simulated", // they are on the page; nothing needs sending
        role: "owner",
      });
    } catch {
      // A grant-quota trip must not strip someone of the studio they just
      // built. Fall through with a null token; linkMe is the way back in.
      inviteToken = null;
    }

    return { ...created, inviteToken };
  },
});

/**
 * Self-heal: attach the signed-in user to the beta studio that is waiting for
 * them.
 *
 * For anyone who created a Clerk account outside the invite flow and landed in
 * a workspace they cannot open. Matches strictly: the org must be beta cohort,
 * the members row must carry their own verified email, and it must not already
 * be linked - so this can attach an account to a waiting seat and can never
 * take over somebody else's.
 */
export const linkMe = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) return { linked: false as const, reason: "no_identity" as const };
    const email = identity.email.toLowerCase();

    const orphan = (await ctx.db.query("members").collect()).find(
      (m) => !m.clerkUserId && (m.email ?? "").toLowerCase() === email,
    );
    if (!orphan) return { linked: false as const, reason: "nothing_waiting" as const };

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orphan.orgId))
      .first();
    if (!org?.betaCohort) return { linked: false as const, reason: "not_beta" as const };

    await ctx.db.patch(orphan._id, { clerkUserId: identity.subject });
    return { linked: true as const, orgId: org.orgId, slug: org.slug, name: org.name };
  },
});

/**
 * Create the workspace row for a claimed invite.
 *
 * Deliberately separate from agency.createSubaccount: that path is an agency
 * admin provisioning Clerk orgs and needs their capabilities. This one is a
 * beta recipient creating their own workspace off a signed invite, so the
 * authorization is the signature, and the Clerk org is created later when
 * they actually sign in.
 */
export const _provision = internalMutation({
  args: {
    agencyId: v.optional(v.string()),
    name: v.string(),
    slug: v.string(),
    ownerName: v.string(),
    ownerEmail: v.string(),
    code: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ slug: string; orgId: string }> => {
    const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (slug.length < 2) {
      throw new ConvexError({ code: "SLUG_SHORT", message: "Pick a longer studio address." });
    }
    const taken = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (taken) {
      throw new ConvexError({
        code: "SLUG_TAKEN",
        message: `The address "${slug}" is already taken. Try another.`,
      });
    }

    // Provisional org id until a real Clerk org exists at first sign-in.
    const orgId = `beta_${slug}_${Math.abs(hashSeed(slug + args.ownerEmail))}`;
    const betaPlanId = await defaultAgencyPlanId(ctx, args.agencyId);
    await ctx.db.insert("orgs", {
      orgId,
      name: args.name.trim(),
      slug,
      plan: "studio",
      /* Label: a beta tester is being asked to evaluate the product, and
         evaluating it through a locked door is not an evaluation. */
      tier: BETA_TIER,
      status: "setup",
      agencyId: args.agencyId,
      /* On the Beta plan from the first minute. Without a plan row the
         billing gate reads "no_plan": no countdown, no end-of-beta warnings
         and nothing for the plan picker to convert. The clock itself still
         starts at their first sign-in after signing, so no trialEndsAt here. */
      ...(betaPlanId ? { agencyPlanId: betaPlanId, billingStatus: "trialing" as const } : {}),
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      createdByAgency: Boolean(args.agencyId),
      betaCohort: true,
      betaInviteCode: args.code,
      betaClaimedAt: Date.now(),
    });
    await ctx.db.insert("members", {
      orgId,
      name: args.ownerName,
      email: args.ownerEmail,
      role: "owner",
      skills: [],
    });
    return { slug, orgId };
  },
});

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 8;
}


/* ── Engagement tracking ────────────────────────────────────── */

/** Internal: the email was rendered in a mail client. Called by the tracking
 *  pixel route, never by a client. */
export const _recordEmailOpen = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(code)))
      .first();
    if (!invite) return;
    const now = Date.now();
    await ctx.db.patch(invite._id, {
      emailOpenedAt: invite.emailOpenedAt ?? now,
      emailOpenCount: (invite.emailOpenCount ?? 0) + 1,
    });
  },
});

/**
 * Record that a beta recipient signed in to the studio they built.
 *
 * Called from the app shell for a workspace that came out of a beta invite.
 * Deliberately cheap and idempotent-ish: it writes at most once per session
 * from the client, and a missed write costs a data point, never a login.
 */
export const recordLogin = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false as const };

    const target = await ctx.db
      .query("betaInvites")
      .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
      .first();
    // Not a beta workspace. Nothing to record, and nothing wrong.
    if (!target) return { ok: false as const };

    const now = Date.now();
    await ctx.db.patch(target._id, {
      firstLoginAt: target.firstLoginAt ?? now,
      lastLoginAt: now,
      loginCount: (target.loginCount ?? 0) + 1,
    });
    return { ok: true as const };
  },
});


/** Whether the SIGNED-IN studio still owes a signature, and the link to give
 *  it. Drives the in-app prompt, so a converted studio that never opened the
 *  email still gets asked. */
export const myBetaSignature = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org?.betaCohort) return { needed: false as const };

    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
      .first();
    if (!invite || invite.signedAt) return { needed: false as const };

    return {
      needed: true as const,
      code: invite.code,
      studioName: org.name,
      licenseUntil: org.betaLicenseUntil ?? null,
    };
  },
});
