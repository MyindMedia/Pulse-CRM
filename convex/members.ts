import { query, mutation, action, internalMutation, internalQuery, internalAction, QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability, resolveViewer } from "./lib/access";
import { meterStorageUpload } from "./usage";
import { sendEmail } from "./lib/email";
import { normalizePhone } from "./lib/phone";
import {
  teammateEmailHtml,
  teammateEmailSubject,
} from "./lib/emailTemplates/invite";
import { normalizeEmail, sameEmail } from "./lib/emailKey";

const roleV = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("engineer"),
  v.literal("assistant_engineer"),
  v.literal("artist_relations"),
  v.literal("producer"),
  v.literal("intern"),
  v.literal("accountant"),
);

type StaffRole =
  | "owner" | "manager" | "engineer" | "assistant_engineer"
  | "artist_relations" | "producer" | "intern" | "accountant";

type InviteContext = {
  email: string;
  name: string;
  phone?: string;
  role: StaffRole;
  orgId: string;
  clerkOrgId?: string;
  agencyId?: string;
  studioName: string;
  inviterName: string;
};

/** Record a fresh invite token + send the branded staff email. Shared by the
 *  first invite (`inviteTeammate`) and `resendInvite`. Non-fatal: returns
 *  whether the email actually sent; never throws on a send hiccup. */
async function sendTeammateInvite(ctx: ActionCtx, c: InviteContext): Promise<boolean> {
  try {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const token = await ctx.runMutation(internal.invites.record, {
      orgId: c.orgId,
      clerkOrgId: c.clerkOrgId,
      agencyId: c.agencyId,
      email: c.email,
      phone: c.phone,
      ownerName: c.name,
      studioName: c.studioName,
      invitedBy: c.inviterName,
      emailStatus: "simulated",
      role: c.role,
    });
    const status = await sendEmail({
      to: c.email,
      subject: teammateEmailSubject(c.studioName),
      html: teammateEmailHtml({
        memberName: c.name,
        studioName: c.studioName,
        inviterName: c.inviterName,
        role: c.role,
        acceptUrl: `${appUrl}/invite/${token}`,
        logoUrl: `${appUrl}/pulse-logo.png`,
      }),
    });
    await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });
    return status === "sent";
  } catch (err) {
    console.error("[sendTeammateInvite] failed (non-fatal):", err);
    return false;
  }
}

/** Per-member invitation state for the team table.
 *  active  = they've joined (Clerk account linked, or invite accepted)
 *  pending = invite sent, not yet accepted, still valid
 *  expired = invite sent, link lapsed (resend to refresh)
 *  none    = no live invite (has an email → can be invited/resent)         */
export type InviteStatus = "active" | "pending" | "expired" | "none";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    // One pass over the org's invites → latest invite per (lowercased) email.
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const latestByEmail = new Map<string, (typeof invites)[number]>();
    for (const inv of invites) {
      const key = inv.email.toLowerCase();
      const prev = latestByEmail.get(key);
      if (!prev || inv._creationTime > prev._creationTime) latestByEmail.set(key, inv);
    }
    const now = Date.now();

    const annotated = await Promise.all(
      rows.map(async (r) => {
        let inviteStatus: InviteStatus = "none";
        let invitedAt: number | undefined;
        if (r.clerkUserId) {
          inviteStatus = "active";
        } else if (r.email) {
          const inv = latestByEmail.get(r.email.toLowerCase());
          if (inv) {
            invitedAt = inv._creationTime;
            if (inv.status === "accepted") inviteStatus = "active";
            else if (inv.status === "pending") inviteStatus = inv.expiresAt > now ? "pending" : "expired";
            else inviteStatus = "none"; // revoked
          }
        }
        return {
          ...r,
          photoUrl: r.photoId ? await ctx.storage.getUrl(r.photoId) : (r.clerkImageUrl ?? null),
          inviteStatus,
          invitedAt,
        };
      }),
    );
    return annotated.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Lightweight roster for engineer pickers. */
export const engineers = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const hydrated = await Promise.all(
      rows.map(async (r) => ({
        _id: r._id,
        name: r.name,
        role: r.role,
        avatarColor: r.avatarColor,
        photoUrl: r.photoId ? await ctx.storage.getUrl(r.photoId) : (r.clerkImageUrl ?? null),
      })),
    );
    return hydrated.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: roleV,
    skills: v.optional(v.array(v.string())),
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    return await ctx.db.insert("members", {
      orgId,
      name: args.name,
      email: normalizeEmail(args.email),
      phone: args.phone ? (normalizePhone(args.phone) ?? undefined) : undefined,
      role: args.role,
      skills: args.skills ?? [],
      capabilityOverrides: args.capabilityOverrides,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("members"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.optional(roleV),
    skills: v.optional(v.array(v.string())),
    capabilityOverrides: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, phone, ...patch }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (member.role === "owner" && patch.role && patch.role !== "owner") {
      throw new Error("cannot demote owner");
    }
    const clean: Record<string, unknown> = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    // Empty string clears the phone; a value is normalized to E.164.
    if (phone !== undefined) clean.phone = phone.trim() ? (normalizePhone(phone) ?? undefined) : undefined;
    await ctx.db.patch(id, clean);
  },
});

/** Set an engineer's public booking-page profile: a short bio + notable
 *  credits (proof-of-work shown where a client picks who runs their session).
 *  Gated on members.invite (mirrors `update`). Empty credits are dropped. */
export const setProfile = mutation({
  args: {
    id: v.id("members"),
    bio: v.optional(v.string()),
    credits: v.optional(v.array(v.string())),
    spotifyUrl: v.optional(v.string()),
    playlistUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, bio, credits, spotifyUrl, playlistUrls }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    const patch: Record<string, unknown> = {};
    if (bio !== undefined) patch.bio = bio.trim() || undefined;
    if (credits !== undefined) {
      const clean = credits.map((c) => c.trim()).filter((c) => c.length > 0);
      patch.credits = clean.length ? clean : undefined;
    }
    const httpOk = (u: string) => /^https?:\/\//i.test(u);
    if (spotifyUrl !== undefined) {
      const u = spotifyUrl.trim();
      if (u && !httpOk(u)) throw new Error("Spotify link must be a full https:// URL.");
      patch.spotifyUrl = u || undefined;
    }
    if (playlistUrls !== undefined) {
      const clean = playlistUrls.map((u) => u.trim()).filter(Boolean).slice(0, 10);
      if (clean.some((u) => !httpOk(u))) throw new Error("Playlist links must be full https:// URLs.");
      patch.playlistUrls = clean.length ? clean : undefined;
    }
    await ctx.db.patch(id, patch);
  },
});

/** Set a teammate's pay - hourly (cents/hour) or salary (annual cents). Pass
 *  payType null to clear. Owner/manager (members.invite) only; this is the
 *  basis for payroll. */
export const setPay = mutation({
  args: {
    id: v.id("members"),
    payType: v.union(v.literal("hourly"), v.literal("salary"), v.null()),
    payRateCents: v.optional(v.number()),
  },
  handler: async (ctx, { id, payType, payRateCents }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (payType !== null && (payRateCents === undefined || payRateCents < 0)) {
      throw new Error("Enter a pay rate.");
    }
    await ctx.db.patch(id, {
      payType: payType === null ? undefined : payType,
      payRateCents: payType === null ? undefined : payRateCents,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "members.remove");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (member.role === "owner") throw new Error("cannot remove owner");
    await ctx.db.delete(id);
  },
});

/**
 * Internal: create (or reuse) the member row for an invited teammate and
 * surface the context the invite email needs. Runs in a mutation so it can
 * enforce the `members.invite` capability and read the org/inviter.
 */
export const _prepareTeammate = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role: roleV,
    skills: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const inviterName = await currentActor(ctx);
    const phone = args.phone ? (normalizePhone(args.phone) ?? undefined) : undefined;

    // Reuse an existing un-claimed member with the same email (avoids dupes if
    // the inviter re-sends); otherwise create the row.
    const existing = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).find((m) => sameEmail(m.email, args.email));

    let memberId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        role: args.role,
        skills: args.skills ?? existing.skills,
        ...(phone ? { phone } : {}),
      });
    } else {
      memberId = await ctx.db.insert("members", {
        orgId,
        name: args.name,
        email: normalizeEmail(args.email),
        phone,
        role: args.role,
        skills: args.skills ?? [],
      });
    }

    return {
      memberId: memberId!,
      orgId,
      clerkOrgId: org?.clerkOrgId,
      agencyId: org?.agencyId,
      studioName: org?.name ?? "the studio",
      inviterName,
      phone,
    };
  },
});

/**
 * Invite a teammate by email. Creates their member row, records a role-scoped
 * invite token, and sends a branded staff invitation. Called automatically by
 * the team dialog whenever an email is supplied. Non-fatal email: the member is
 * created regardless so they can be scheduled even if the send hiccups.
 */
export const inviteTeammate = action({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role: roleV,
    skills: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ memberId: string; inviteSent: boolean }> => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    const name = args.name.trim() || email;

    const prep = await ctx.runMutation(internal.members._prepareTeammate, {
      name,
      email,
      phone: args.phone,
      role: args.role,
      skills: args.skills,
    });

    const inviteSent = await sendTeammateInvite(ctx, {
      email,
      name,
      phone: prep.phone,
      role: args.role,
      orgId: prep.orgId,
      clerkOrgId: prep.clerkOrgId,
      agencyId: prep.agencyId,
      studioName: prep.studioName,
      inviterName: prep.inviterName,
    });

    return { memberId: prep.memberId, inviteSent };
  },
});

/**
 * Internal: resolve the invite context for an EXISTING member row. Enforces
 * the invite capability, and refuses members with no email or who've already
 * joined (those throws surface to the resend caller as friendly messages).
 */
export const _inviteContextForMember = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }): Promise<InviteContext> => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(memberId);
    if (!member || member.orgId !== orgId) throw new ConvexError("Member not found.");
    if (!member.email) throw new ConvexError("This member has no email to send an invite to.");
    if (member.clerkUserId) throw new ConvexError("This member has already joined.");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return {
      email: member.email.toLowerCase(),
      name: member.name,
      phone: member.phone,
      role: member.role as StaffRole,
      orgId,
      clerkOrgId: org?.clerkOrgId,
      agencyId: org?.agencyId,
      studioName: org?.name ?? "the studio",
      inviterName: await currentActor(ctx),
    };
  },
});

/** Re-send a teammate's invitation (fresh token + email) from the team table. */
export const resendInvite = action({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }): Promise<{ inviteSent: boolean }> => {
    const c = await ctx.runMutation(internal.members._inviteContextForMember, { memberId });
    const inviteSent = await sendTeammateInvite(ctx, c);
    return { inviteSent };
  },
});

/** Signed URL for uploading a team member's profile photo (org-gated). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded profile photo to a team member (same org only). */
export const setPhoto = mutation({
  args: { id: v.id("members"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    await meterStorageUpload(ctx, orgId, storageId, member.photoId ?? null);
    await ctx.db.patch(id, { photoId: storageId });
  },
});

/** Remove a team member's uploaded photo. */
export const clearPhoto = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { photoId: undefined });
  },
});

// ── Self-service (a teammate acting on their OWN member row) ──────────────

/** The signed-in teammate's own member row (mapped via Clerk id), or null. */
async function myMemberRow(ctx: QueryCtx | MutationCtx) {
  const orgId = await currentOrg(ctx);
  const viewer = await resolveViewer(ctx).catch(() => null);
  const clerkUserId = viewer && "clerkUserId" in viewer ? viewer.clerkUserId : null;
  if (!clerkUserId) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
    .first();
}

/** The caller's own profile - powers the staff onboarding wizard. */
export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const me = await myMemberRow(ctx);
    if (!me) return null;
    return {
      _id: me._id,
      name: me.name,
      role: me.role,
      email: me.email ?? null,
      phone: me.phone ?? null,
      photoUrl: me.photoId ? await ctx.storage.getUrl(me.photoId) : (me.clerkImageUrl ?? null),
      hasUploadedPhoto: Boolean(me.photoId),
    };
  },
});

/** A teammate edits their OWN name/phone (no team-manage capability needed). */
export const updateMyProfile = mutation({
  args: { name: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, { name, phone }) => {
    const me = await myMemberRow(ctx);
    if (!me) throw new Error("Only team members can edit their own profile.");
    const patch: Record<string, unknown> = {};
    if (name !== undefined && name.trim()) patch.name = name.trim();
    if (phone !== undefined) patch.phone = phone.trim() || undefined;
    await ctx.db.patch(me._id, patch);
  },
});

/** A teammate attaches a photo to their OWN member row (no invite cap needed). */
export const setMyPhoto = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await myMemberRow(ctx);
    if (!me) throw new Error("Only team members can set their own photo.");
    await meterStorageUpload(ctx, me.orgId, storageId, me.photoId ?? null);
    await ctx.db.patch(me._id, { photoId: storageId });
  },
});

/** A teammate removes their OWN photo. */
export const clearMyPhoto = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await myMemberRow(ctx);
    if (!me) throw new Error("Only team members can clear their own photo.");
    await ctx.db.patch(me._id, { photoId: undefined });
  },
});

/**
 * Link the signed-in Clerk user to their pre-created member row by verified
 * email, and flip their pending invite to "accepted". Called once on app mount
 * (see MemberSync). Works straight off the Clerk identity - NOT resolveViewer -
 * because resolveViewer throws NO_STUDIO_MEMBER until this link exists, so this
 * is what breaks that chicken-and-egg the first time a teammate logs in. Safe:
 * a user can only claim a member that carries their own Clerk-verified email in
 * their own Clerk org. Idempotent.
 */
export const syncMyClerkLink = mutation({
  args: {},
  handler: async (ctx): Promise<{ linked: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { linked: false };
    const clerkUserId = identity.subject;
    const orgId = (identity as { orgId?: string }).orgId;
    const email = identity.email?.toLowerCase();
    if (!orgId || !email) return { linked: false };

    const pictureUrl =
      typeof identity.pictureUrl === "string" && identity.pictureUrl ? identity.pictureUrl : undefined;

    // Already linked in this org → refresh the cached Clerk avatar and finish.
    const already = await ctx.db
      .query("members")
      .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
      .first();
    if (already) {
      if (pictureUrl && already.clerkImageUrl !== pictureUrl) {
        await ctx.db.patch(already._id, { clerkImageUrl: pictureUrl });
      }
      return { linked: true };
    }

    // Claim an un-linked member row that carries this verified email.
    const member = (
      await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).find((m) => sameEmail(m.email, email) && !m.clerkUserId);
    if (!member) return { linked: false };
    await ctx.db.patch(member._id, { clerkUserId, ...(pictureUrl ? { clerkImageUrl: pictureUrl } : {}) });

    // Flip the latest pending invite for this email to accepted.
    const invite = (
      await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    )
      .filter((i) => sameEmail(i.email, email) && i.status === "pending")
      .sort((a, b) => b._creationTime - a._creationTime)[0];
    if (invite) await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: Date.now() });

    return { linked: true };
  },
});

/* ── Clerk avatar backfill ──────────────────────────────────────
   One-shot sweep: members already linked to a Clerk user but with
   no cached avatar get their Clerk profile image pulled via the
   Backend API. Day-to-day, syncMyClerkLink refreshes the avatar on
   every login - this covers rows linked before that existed. */

export const _membersNeedingAvatar = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("members").collect();
    return rows
      .filter((m) => m.clerkUserId && !m.clerkImageUrl && !m.photoId)
      .map((m) => ({ _id: m._id, clerkUserId: m.clerkUserId! }));
  },
});

export const _setClerkImage = internalMutation({
  args: { id: v.id("members"), clerkImageUrl: v.string() },
  handler: async (ctx, { id, clerkImageUrl }) => {
    await ctx.db.patch(id, { clerkImageUrl });
  },
});

export const backfillClerkPhotos = internalAction({
  args: {},
  handler: async (ctx): Promise<{ filled: number; checked: number }> => {
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) return { filled: 0, checked: 0 };
    const rows: { _id: string; clerkUserId: string }[] = await ctx.runQuery(
      internal.members._membersNeedingAvatar,
      {},
    );
    let filled = 0;
    for (const row of rows) {
      try {
        const res = await fetch(`https://api.clerk.com/v1/users/${row.clerkUserId}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) continue;
        const user = (await res.json()) as { image_url?: string; has_image?: boolean };
        if (user.has_image && user.image_url) {
          await ctx.runMutation(internal.members._setClerkImage, {
            id: row._id as never,
            clerkImageUrl: user.image_url,
          });
          filled++;
        }
      } catch {
        // skip this member; the next login sync will catch them
      }
    }
    return { filled, checked: rows.length };
  },
});

/* ── Seed/import a member photo (ops tooling, internal only) ──── */

export const _setSeededPhoto = internalMutation({
  args: { id: v.id("members"), storageId: v.id("_storage") },
  handler: async (ctx, { id, storageId }) => {
    await ctx.db.patch(id, { photoId: storageId });
  },
});

export const importMemberPhoto = internalAction({
  args: { id: v.id("members"), dataBase64: v.string(), mime: v.string() },
  handler: async (ctx, { id, dataBase64, mime }) => {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
    await ctx.runMutation(internal.members._setSeededPhoto, { id, storageId });
    return { stored: true };
  },
});

/** Ops: seed contact details on a member row (demo accounts). */
export const _seedMemberContact = internalMutation({
  args: {
    id: v.id("members"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v2]) => v2 !== undefined));
    await ctx.db.patch(id, clean);
  },
});

/* ── Admin repair: relink a member row to a new Clerk user ──────
   The 07-08 production cutover left some member rows pointing at Clerk
   user ids that no longer exist ("ghost links"), which blocks
   syncMyClerkLink's claim (it only claims UN-linked rows). CLI-run only:
   `npx convex run members:_relinkClerkUser '{"orgId":"...","email":"...","clerkUserId":"user_..."}'` */
export const _relinkClerkUser = internalMutation({
  args: { orgId: v.string(), email: v.string(), clerkUserId: v.string() },
  handler: async (ctx, { orgId, email, clerkUserId }) => {
    const row = (
      await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).find((m) => sameEmail(m.email, email));
    if (!row) throw new Error("No member row with that email in that org");
    const previous = row.clerkUserId ?? null;
    await ctx.db.patch(row._id, { clerkUserId });
    return { memberId: row._id, name: row.name, previous, now: clerkUserId };
  },
});
