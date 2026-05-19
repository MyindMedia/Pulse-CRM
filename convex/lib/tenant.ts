import { QueryCtx, MutationCtx } from "../_generated/server";
import { resolveViewer } from "./access";

/* The seeded workspace used whenever Clerk auth is not configured. */
export const DEMO_ORG = "pulse-demo";

type Ctx = QueryCtx | MutationCtx;

/**
 * Resolve the caller's organization. Backed by the Access Engine —
 * agency, studio, and guest viewers all expose an `orgId`. orgId is
 * never trusted from client arguments; always derived here.
 */
export async function currentOrg(ctx: Ctx): Promise<string> {
  const viewer = await resolveViewer(ctx);
  // Agency viewers expose orgId only when they've "entered" a sub-account
  // (appState.activeOrgId). Fall back to DEMO_ORG so reads from the
  // agency console land somewhere sane.
  return viewer.orgId ?? DEMO_ORG;
}

/** A human label for the caller — used for activity/comment attribution. */
export async function currentActor(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.name ?? identity?.email ?? "Studio";
}

/** Throw unless a fetched document belongs to the caller's org. */
export function assertOrg<T extends { orgId: string } | null>(
  doc: T,
  orgId: string,
): asserts doc is NonNullable<T> {
  if (!doc || doc.orgId !== orgId) throw new Error("Not found");
}
