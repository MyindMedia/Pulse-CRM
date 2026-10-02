import type { QueryCtx, MutationCtx } from "../_generated/server";
import { resolveViewer, AccessError } from "../lib/access";
import { redact } from "./policy";

export type Ctx = QueryCtx | MutationCtx;
export type AgencyScope = { agencyId: string; actor: string; role: string; canManage: boolean };

/** The caller's agency scope, or null for anyone who is not an agency member
 *  (anonymous, demo, studio member). Queries degrade to "unauthorized". */
export async function agencyScope(ctx: Ctx): Promise<AgencyScope | null> {
  let viewer;
  try {
    viewer = await resolveViewer(ctx);
  } catch {
    return null;
  }
  if (viewer.kind !== "agency_member") return null;
  return {
    agencyId: viewer.agencyId,
    actor: viewer.clerkUserId,
    role: viewer.role,
    canManage: viewer.role === "owner" || viewer.role === "admin",
  };
}

export async function requireAgencyScope(ctx: Ctx): Promise<AgencyScope> {
  const scope = await agencyScope(ctx);
  if (!scope) throw new AccessError("FORBIDDEN", "Agency access required");
  return scope;
}


export async function logEvent(
  ctx: MutationCtx,
  agencyId: string,
  actor: string,
  action: string,
  result: "ok" | "denied" | "unknown",
  resource?: string,
  detail?: string,
) {
  await ctx.db.insert("outreachEvents", {
    agencyId, at: Date.now(), actor, action, result, resource, detail: redact(detail),
  });
}

