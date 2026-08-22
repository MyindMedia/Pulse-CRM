import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireCapability } from "./lib/access";
import { sendEmail } from "./lib/email";
import { inviteEmailHtml, inviteEmailSubject } from "./lib/emailTemplates/invite";
import { findByEmail, normalizeEmail } from "./lib/emailKey";

/* ============================================================
   Handing a staged studio to its real owner.

   The pitch machine (stageDemo) builds a fully branded sub-account from a
   prospect's website - their name, their colours, their rooms, their rates -
   and fills it with demo data so the agency can walk them through a studio
   that looks like theirs. What it deliberately does NOT build is an owner:
   a staged account has no ownerEmail, no members row, and no way in.

   When the deal closes, that gap is the whole job. Everything else about the
   workspace is already right and must survive untouched, so this is an
   attach, never a re-create:

     - write the owner onto the existing org
     - give them the members row the access engine resolves against
     - wipe the demo rows (their studio should open empty, not full of
       invented clients) while keeping branding, rooms and gear
     - reset the onboarding flag so their first login walks /welcome
     - mint the standard invite token and send the standard invite email

   Nothing here creates an org, a slug or a Clerk organization. A staged
   account keeps its `staged-` orgId for life, which is fine: the access
   engine resolves a studio member with no Clerk org through the
   single-membership path, exactly as a beta-claimed studio does.
   ============================================================ */

export const _snapshot = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return null;
    return {
      orgId: org.orgId,
      name: org.name,
      slug: org.slug,
      agencyId: org.agencyId ?? null,
      ownerEmail: org.ownerEmail ?? null,
      ownerName: org.ownerName ?? null,
      clerkOrgId: org.clerkOrgId ?? null,
      demoMode: org.demoMode === true,
    };
  },
});

/** Attach the owner to an existing org: org fields + the members row the
 *  access engine resolves against. Idempotent on the members row. */
export const _attachOwner = internalMutation({
  args: {
    orgId: v.string(),
    ownerName: v.string(),
    ownerEmail: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, ownerName, ownerEmail, force }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new ConvexError(`No studio with orgId ${orgId}`);

    /* Handing over a studio that already has an owner would quietly transfer
       somebody's live workspace to a different person. That is never a
       typo-recoverable action, so it takes an explicit force. */
    const existing = org.ownerEmail?.trim().toLowerCase();
    const incoming = ownerEmail.trim().toLowerCase();
    if (existing && existing !== incoming && !force) {
      throw new ConvexError(
        `${org.name} already belongs to ${org.ownerEmail}. Pass force to reassign it.`,
      );
    }

    await ctx.db.patch(org._id, { ownerName, ownerEmail: normalizeEmail(ownerEmail) });

    // invites.accept matches the member by (orgId, email) and writes
    // clerkUserId onto it, so the row has to exist before the invite is sent.
    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const already = findByEmail(members, incoming);
    let memberCreated = false;
    if (already) {
      if (already.role !== "owner") await ctx.db.patch(already._id, { role: "owner" });
    } else {
      await ctx.db.insert("members", {
        orgId,
        name: ownerName,
        email: normalizeEmail(ownerEmail),
        role: "owner",
        skills: [],
      });
      memberCreated = true;
    }

    await ctx.db.insert("activity", {
      orgId,
      kind: "account.handed_over",
      summary: `${org.name} handed to ${ownerName} (${ownerEmail.trim()})`,
      accent: "gold",
    });

    return {
      orgId,
      name: org.name,
      slug: org.slug,
      agencyId: org.agencyId ?? undefined,
      reassignedFrom: existing && existing !== incoming ? org.ownerEmail ?? null : null,
      memberCreated,
    };
  },
});

type HandOverResult = {
  orgId: string;
  name: string;
  slug: string;
  ownerEmail: string;
  demoRowsRemoved: number;
  inviteToken: string | null;
  inviteEmailStatus: "sent" | "failed" | "simulated" | "skipped";
  reassignedFrom: string | null;
};

/** The work, once the caller is known to be allowed to do it. */
export const _handOver = internalAction({
  args: {
    orgId: v.string(),
    ownerName: v.string(),
    ownerEmail: v.string(),
    /** Wipe the pitch data. On by default - a real owner should not inherit
     *  invented clients and bookings. */
    wipeDemo: v.optional(v.boolean()),
    /** Send the branded invite so they can create their login. */
    send: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<HandOverResult> => {
    const attached = await ctx.runMutation(internal.handover._attachOwner, {
      orgId: args.orgId,
      ownerName: args.ownerName,
      ownerEmail: normalizeEmail(args.ownerEmail),
      force: args.force,
    });

    let demoRowsRemoved = 0;
    if (args.wipeDemo !== false) {
      const staged = await ctx.runMutation(internal.demoMode._stageForOnboarding, {
        orgId: args.orgId,
      });
      demoRowsRemoved = staged.removed;
    }

    let inviteToken: string | null = null;
    let inviteEmailStatus: "sent" | "failed" | "simulated" | "skipped" = "skipped";
    if (args.send !== false) {
      const appUrl = process.env.APP_URL ?? "https://studiopulse.tech";
      inviteToken = await ctx.runMutation(internal.invites.record, {
        orgId: attached.orgId,
        agencyId: attached.agencyId,
        email: normalizeEmail(args.ownerEmail),
        ownerName: args.ownerName,
        studioName: attached.name,
        invitedBy: "handover",
        emailStatus: "simulated",
      });
      inviteEmailStatus = await sendEmail({
        to: args.ownerEmail.trim(),
        subject: inviteEmailSubject(attached.name),
        html: inviteEmailHtml({
          ownerName: args.ownerName,
          studioName: attached.name,
          inviterName: "your Pulse administrator",
          acceptUrl: `${appUrl}/invite/${inviteToken}`,
          logoUrl: `${appUrl}/pulse-logo.png`,
        }),
      });
      await ctx.runMutation(internal.invites.setEmailStatus, {
        token: inviteToken,
        emailStatus: inviteEmailStatus,
      });
    }

    return {
      orgId: attached.orgId,
      name: attached.name,
      slug: attached.slug,
      ownerEmail: normalizeEmail(args.ownerEmail),
      demoRowsRemoved,
      inviteToken,
      inviteEmailStatus,
      reassignedFrom: attached.reassignedFrom ?? null,
    };
  },
});

/** Agency console entry point. */
export const handOverStaged = action({
  args: {
    orgId: v.string(),
    ownerName: v.string(),
    ownerEmail: v.string(),
    wipeDemo: v.optional(v.boolean()),
    send: v.optional(v.boolean()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<HandOverResult> => {
    await ctx.runQuery(internal.handover._assertCanHandOver, { orgId: args.orgId });
    return await ctx.runAction(internal.handover._handOver, args);
  },
});

export const _assertCanHandOver = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    // Same gate as pausing a sub-account: this is an agency-level act on
    // somebody else's workspace, not something a studio member can do.
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    return null;
  },
});
