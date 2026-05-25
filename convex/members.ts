import { query, mutation, action, internalMutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability, resolveViewer } from "./lib/access";
import { sendEmail } from "./lib/email";
import {
  teammateEmailHtml,
  teammateEmailSubject,
} from "./lib/emailTemplates/invite";

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

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const withPhotos = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        photoUrl: r.photoId ? await ctx.storage.getUrl(r.photoId) : null,
      })),
    );
    return withPhotos.sort((a, b) => a.name.localeCompare(b.name));
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
    return rows
      .map((r) => ({ _id: r._id, name: r.name, role: r.role, avatarColor: r.avatarColor }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
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
      email: args.email,
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
    role: v.optional(roleV),
    skills: v.optional(v.array(v.string())),
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);
    const member = await ctx.db.get(id);
    if (!member || member.orgId !== orgId) throw new Error("Not found");
    if (member.role === "owner" && patch.role && patch.role !== "owner") {
      throw new Error("cannot demote owner");
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
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
  args: { name: v.string(), email: v.string(), role: roleV, skills: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = ("orgId" in viewer && viewer.orgId) ? viewer.orgId : await currentOrg(ctx);

    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const inviterName = await currentActor(ctx);

    // Reuse an existing un-claimed member with the same email (avoids dupes if
    // the inviter re-sends); otherwise create the row.
    const existing = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).find((m) => m.email && m.email.toLowerCase() === args.email.toLowerCase());

    let memberId = existing?._id;
    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name, role: args.role, skills: args.skills ?? existing.skills });
    } else {
      memberId = await ctx.db.insert("members", {
        orgId,
        name: args.name,
        email: args.email,
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
  args: { name: v.string(), email: v.string(), role: roleV, skills: v.optional(v.array(v.string())) },
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
      role: args.role,
      skills: args.skills,
    });

    let inviteSent = false;
    try {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const token = await ctx.runMutation(internal.invites.record, {
        orgId: prep.orgId,
        clerkOrgId: prep.clerkOrgId,
        agencyId: prep.agencyId,
        email,
        ownerName: name,
        studioName: prep.studioName,
        invitedBy: prep.inviterName,
        emailStatus: "simulated",
        role: args.role,
      });
      const status = await sendEmail({
        to: email,
        subject: teammateEmailSubject(prep.studioName),
        html: teammateEmailHtml({
          memberName: name,
          studioName: prep.studioName,
          inviterName: prep.inviterName,
          role: args.role,
          acceptUrl: `${appUrl}/invite/${token}`,
          logoUrl: `${appUrl}/pulse-logo.png`,
        }),
      });
      await ctx.runMutation(internal.invites.setEmailStatus, { token, emailStatus: status });
      inviteSent = status === "sent";
    } catch (err) {
      console.error("[inviteTeammate] invite step failed (non-fatal):", err);
    }

    return { memberId: prep.memberId, inviteSent };
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
      photoUrl: me.photoId ? await ctx.storage.getUrl(me.photoId) : null,
    };
  },
});

/** A teammate attaches a photo to their OWN member row (no invite cap needed). */
export const setMyPhoto = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await myMemberRow(ctx);
    if (!me) throw new Error("Only team members can set their own photo.");
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
