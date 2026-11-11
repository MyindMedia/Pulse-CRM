import type { QueryCtx, MutationCtx } from "../_generated/server";
import { AccessError } from "../lib/access";
import { platformAgencyId } from "../lib/platformAgency";
import { agencyScope, type AgencyScope } from "../outreach/scope";

/* Who may use the agency CRM (design D1): an owner or admin of the Pulse platform
   agency, nobody else. The agency is always derived from the signed-in viewer and
   compared with the platform agency; it is never a client argument. */

type Ctx = QueryCtx | MutationCtx;

export type CrmAccess = { allowed: true; scope: AgencyScope } | { allowed: false; reason: "signed_out" | "forbidden" | "not_setup" };

export async function crmAccess(ctx: Ctx): Promise<CrmAccess> {
  const scope = await agencyScope(ctx);
  if (!scope) return { allowed: false, reason: "signed_out" };
  if (!scope.canManage) return { allowed: false, reason: "forbidden" };
  const platform = await platformAgencyId(ctx);
  if (!platform) return { allowed: false, reason: "not_setup" };
  if (scope.agencyId !== platform) return { allowed: false, reason: "forbidden" };
  return { allowed: true, scope };
}

export async function requireCrm(ctx: Ctx): Promise<AgencyScope> {
  const a = await crmAccess(ctx);
  if (a.allowed) return a.scope;
  throw new AccessError("FORBIDDEN", "Only an owner or admin of the Pulse agency can use the CRM");
}
