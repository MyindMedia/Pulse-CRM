import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { AccessError, resolveViewer } from "./access";
import type { Capability, Viewer } from "./accessTypes";
import { currentOrgWithCapability } from "./tenant";

type Ctx = QueryCtx | MutationCtx;

/* ============================================================
   Who may touch one booking's staff-only extras (notes, files, extra
   songs). Always the same three questions, in this order:
     1. a signed-in staff member (a guest link never gets in),
     2. holding the capability, in their current studio (agency operators
        through the usual agency scope checks in requireCapability),
     3. and the booking belongs to that studio.
   The studio always comes from the viewer, never from an argument.
   ============================================================ */

export type SessionAccess = {
  viewer: Viewer;
  orgId: string;
  session: Doc<"sessions">;
  /** Stable id of the person acting, for "who wrote this" and own-row checks. */
  actorId: string;
  actorName: string;
  memberId?: Id<"members">;
};

/** Every session extra is part of the booking, which every plan has, so these
 *  calls are never tier-gated by the capability's usual entitlement. */
const UNMETERED = { entitlement: null } as const;

export async function staffSession(
  ctx: Ctx,
  sessionId: Id<"sessions">,
  capability: Capability = "sessions.read",
): Promise<SessionAccess> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind === "guest") throw new ConvexError("Only studio staff can do that.");
  const orgId = await currentOrgWithCapability(ctx, capability, undefined, UNMETERED);
  const session = await ctx.db.get(sessionId);
  if (!session || session.orgId !== orgId) throw new ConvexError("Session not found.");
  const identity = await ctx.auth.getUserIdentity();
  // The demo and system viewers carry a placeholder member id, not a real row.
  const memberId =
    viewer.kind === "studio_member" ? (ctx.db.normalizeId("members", viewer.memberId) ?? undefined) : undefined;
  const member = memberId ? await ctx.db.get(memberId) : null;
  return {
    viewer,
    orgId,
    session,
    actorId: viewer.clerkUserId,
    actorName: member?.name ?? identity?.name ?? identity?.email ?? "Studio",
    memberId,
  };
}

/** Same as staffSession, but a read that answers null instead of throwing, so a
 *  screen never breaks on a booking the caller may not see. */
export async function staffSessionOrNull(
  ctx: Ctx,
  sessionId: Id<"sessions">,
  capability: Capability = "sessions.read",
): Promise<SessionAccess | null> {
  try {
    return await staffSession(ctx, sessionId, capability);
  } catch (err) {
    if (err instanceof AccessError || err instanceof ConvexError) return null;
    throw err;
  }
}

/** True when the viewer holds `capability` outright. requireCapability also
 *  accepts the `.own` variant, so an exact check is needed for "any row". */
export function holds(viewer: Viewer, capability: Capability): boolean {
  return viewer.capabilities.has(capability);
}

/** May this viewer change the booking itself (link songs)? `sessions.edit`
 *  outright, or `sessions.edit.own` on a booking they engineer or created. */
export function canEditSession(a: SessionAccess): boolean {
  if (holds(a.viewer, "sessions.edit")) return true;
  if (!holds(a.viewer, "sessions.edit.own") || !a.memberId) return false;
  return a.session.engineerId === a.memberId || a.session.createdByMemberId === a.memberId;
}

/** Owners and managers (and agency admins acting as the studio) may remove any
 *  staff row; everyone else only their own. Same line the schedule draws. */
export function canModerate(viewer: Viewer): boolean {
  return holds(viewer, "schedule.manage");
}
