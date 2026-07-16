import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { AccessError, resolveViewer } from "./lib/access";

/* ============================================================
   Agency-member self-service profile.

   Agency users (console operators) are recognized two ways - by an
   agencyMembers row, OR by the AGENCY_ADMIN_EMAILS allowlist with no
   row at all (see resolveViewer). The allowlist owner has no persisted
   identity, so the first time they save a profile we provision a real
   agencyMembers row for them. From then on resolveViewer picks them up
   by_clerk and they have a durable, editable profile - same as any
   invited teammate editing their own.

   No special capability is needed to edit your OWN profile, mirroring
   members.updateMyProfile on the studio side.
   ============================================================ */

type Identity = { subject: string; email?: string; name?: string; pictureUrl?: unknown };

async function getIdentity(ctx: QueryCtx | MutationCtx): Promise<Identity | null> {
  const id = await ctx.auth.getUserIdentity();
  if (!id) return null;
  return {
    subject: id.subject,
    email: id.email ?? undefined,
    name: (id as { name?: string }).name ?? undefined,
    pictureUrl: id.pictureUrl,
  };
}

/** The caller's existing agencyMembers row for this agency, if any. */
async function myRow(
  ctx: QueryCtx | MutationCtx,
  agencyId: string,
  clerkUserId: string,
): Promise<Doc<"agencyMembers"> | null> {
  return await ctx.db
    .query("agencyMembers")
    .withIndex("by_agency_clerk", (q) =>
      q.eq("agencyId", agencyId).eq("clerkUserId", clerkUserId))
    .first();
}

function nameFromIdentity(identity: Identity): string {
  if (identity.name && identity.name.trim()) return identity.name.trim();
  const email = identity.email ?? "";
  const local = email.split("@")[0] ?? "";
  return local ? local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Agency user";
}

/** The signed-in agency user's profile (or null when the caller is not an agency user). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    // Shell-chrome read on /agency: the page subscribes the moment it mounts,
    // often BEFORE Clerk auth attaches to the socket (slower still on the
    // satellite domain's proxied Clerk boot). Degrade to null instead of
    // throwing UNAUTHENTICATED into the error boundary - the query re-runs
    // authed a beat later. Same pattern as orgs.current.
    let viewer;
    try {
      viewer = await resolveViewer(ctx);
    } catch (e) {
      if (e instanceof AccessError) return null;
      throw e;
    }
    if (viewer.kind !== "agency_member") return null;
    const identity = await getIdentity(ctx);
    if (!identity) return null;

    const row = await myRow(ctx, viewer.agencyId, identity.subject);
    const clerkPic =
      typeof identity.pictureUrl === "string" && identity.pictureUrl ? identity.pictureUrl : null;

    if (!row) {
      // Allowlist owner with no persisted row yet - synthesize from the token.
      return {
        memberId: null as Id<"agencyMembers"> | null,
        provisioned: false,
        name: nameFromIdentity(identity),
        email: identity.email ?? null,
        role: viewer.role,
        title: null as string | null,
        phone: null as string | null,
        photoUrl: clerkPic,
        hasUploadedPhoto: false,
      };
    }

    return {
      memberId: row._id as Id<"agencyMembers"> | null,
      provisioned: true,
      name: row.name,
      email: row.email ?? identity.email ?? null,
      role: row.role,
      title: row.title ?? null,
      phone: row.phone ?? null,
      photoUrl: row.photoStorageId
        ? await ctx.storage.getUrl(row.photoStorageId)
        : (row.clerkImageUrl ?? clerkPic),
      hasUploadedPhoto: Boolean(row.photoStorageId),
    };
  },
});

/** Find-or-create the caller's own agency row, returning its id. */
async function ensureMyRow(ctx: MutationCtx): Promise<Id<"agencyMembers">> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind !== "agency_member") {
    throw new Error("Only agency users can edit an agency profile.");
  }
  const identity = await getIdentity(ctx);
  if (!identity) throw new Error("Not signed in.");

  const existing = await myRow(ctx, viewer.agencyId, identity.subject);
  if (existing) return existing._id;

  const clerkPic =
    typeof identity.pictureUrl === "string" && identity.pictureUrl ? identity.pictureUrl : undefined;
  return await ctx.db.insert("agencyMembers", {
    agencyId: viewer.agencyId,
    clerkUserId: identity.subject,
    email: identity.email ?? "",
    name: nameFromIdentity(identity),
    // Allowlist callers provision themselves as owner (their resolved role);
    // a real invited member would already have a row and never reach here.
    role: viewer.role,
    status: "active",
    invitedAt: Date.now(),
    lastActiveAt: Date.now(),
    clerkImageUrl: clerkPic,
  });
}

/** Edit your own agency profile. Self-provisions a row for allowlist owners. */
export const updateMine = mutation({
  args: {
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, { name, phone, title }) => {
    const id = await ensureMyRow(ctx);
    const patch: Record<string, unknown> = { lastActiveAt: Date.now() };
    if (name !== undefined && name.trim()) patch.name = name.trim();
    if (phone !== undefined) patch.phone = phone.trim() || undefined;
    if (title !== undefined) patch.title = title.trim() || undefined;
    await ctx.db.patch(id, patch);
    return { memberId: id };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind !== "agency_member") throw new Error("Agency users only.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const setMyPhoto = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const id = await ensureMyRow(ctx);
    await ctx.db.patch(id, { photoStorageId: storageId, lastActiveAt: Date.now() });
  },
});

export const clearMyPhoto = mutation({
  args: {},
  handler: async (ctx) => {
    const id = await ensureMyRow(ctx);
    await ctx.db.patch(id, { photoStorageId: undefined });
  },
});
