import type { QueryCtx, MutationCtx } from "../_generated/server";
import { AccessError } from "../lib/access";
import { agencyScope, type AgencyScope } from "../outreach/scope";

/* Who may use the agency CRM (design D1): an owner or admin of the Pulse platform
   agency, nobody else. The agency is always derived from the signed-in viewer and
   compared with the platform agency; it is never a client argument.

   F-B3: the platform agency must be PINNED with PULSE_AGENCY_ID. The CRM does not
   use platformAgencyId's fallback guess (the one agency without a subscription):
   a guessed tenant is not good enough for lead data and outbound messaging. */

type Ctx = QueryCtx | MutationCtx;

export type CrmAccess = { allowed: true; scope: AgencyScope } | { allowed: false; reason: "signed_out" | "forbidden" | "not_setup" };

/** The pinned Pulse agency id, or null when PULSE_AGENCY_ID is unset. */
export function pinnedAgencyId(): string | null {
  const pinned = process.env.PULSE_AGENCY_ID?.trim();
  return pinned ? pinned : null;
}

export async function crmAccess(ctx: Ctx): Promise<CrmAccess> {
  const scope = await agencyScope(ctx);
  if (!scope) {
    // Signed in but not an agency member (a studio member, say) is "forbidden", not "signed_out".
    const identity = await ctx.auth.getUserIdentity();
    return { allowed: false, reason: identity ? "forbidden" : "signed_out" };
  }
  if (!scope.canManage) return { allowed: false, reason: "forbidden" };
  const platform = pinnedAgencyId();
  if (!platform) return { allowed: false, reason: "not_setup" };
  if (scope.agencyId !== platform) return { allowed: false, reason: "forbidden" };
  if (!(await activeManager(ctx, platform, scope.actor))) return { allowed: false, reason: "forbidden" };
  return { allowed: true, scope };
}

/* F-B4: resolveViewer's legacy orgType "agency" fast path reads the member row
   without checking its status, so a suspended or invited member would pass. The
   CRM re-checks: an ACTIVE owner/admin row in the pinned agency, or an operator
   on the AGENCY_ADMIN_EMAILS allowlist (who has no row by design). */
async function activeManager(ctx: Ctx, agencyId: string, clerkUserId: string): Promise<boolean> {
  const rows = await ctx.db
    .query("agencyMembers")
    .withIndex("by_agency_clerk", (q) => q.eq("agencyId", agencyId).eq("clerkUserId", clerkUserId))
    .collect();
  if (rows.some((m) => m.status === "active" && (m.role === "owner" || m.role === "admin"))) return true;
  if (rows.length > 0) return false; // a row exists but is not an active manager: never fall back to the allowlist
  const identity = await ctx.auth.getUserIdentity();
  const email = ((identity as { email?: string } | null)?.email ?? "").trim().toLowerCase();
  const allow = (process.env.AGENCY_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && allow.includes(email);
}

export async function requireCrm(ctx: Ctx): Promise<AgencyScope> {
  const a = await crmAccess(ctx);
  if (a.allowed) return a.scope;
  throw new AccessError("FORBIDDEN", "Only an owner or admin of the Pulse agency can use the CRM");
}
