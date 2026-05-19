import { QueryCtx, MutationCtx } from "../_generated/server";

/* The seeded workspace used whenever Clerk auth is not configured. */
export const DEMO_ORG = "pulse-demo";

type Ctx = QueryCtx | MutationCtx;

/**
 * Resolve the caller's organization. With Clerk configured this is the
 * active org from the JWT. In demo mode it is the org the agency console
 * has "entered" (the appState singleton), defaulting to "pulse-demo".
 * orgId is never trusted from client arguments — always derived here.
 */
export async function currentOrg(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    const orgId = (identity as { orgId?: string }).orgId;
    return orgId ?? DEMO_ORG;
  }
  const state = await ctx.db
    .query("appState")
    .withIndex("by_key", (q) => q.eq("key", "demo"))
    .first();
  return state?.activeOrgId ?? DEMO_ORG;
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
