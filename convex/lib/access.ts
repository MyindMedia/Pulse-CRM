import { QueryCtx, MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import {
  AGENCY_ROLE_CAPABILITIES,
  STUDIO_ROLE_CAPABILITIES,
  GUEST_SCOPE_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  applyOverrides,
} from "./accessPolicies";
import type {
  Viewer, AgencyViewer, StudioViewer,
  AgencyRole, StudioRole, GrantScope,
  Capability, ResourceRef,
} from "./accessTypes";

/* ============================================================
   Access Engine - one resolver, one require, one audit hook.
   Every Convex business function should either:
     - call requireCapability(ctx, "<cap>", { orgId, entityId })
     - or accept the legacy currentOrg() compat shim (read paths)
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

// Extends ConvexError (not plain Error) so denials propagate to the client with
// a real, readable payload instead of Convex redacting them to "[Server Error]".
// `data` carries the structured { code, message }; `code` stays readable for the
// many `e instanceof AccessError` / `e.code` checks across the codebase.
export class AccessError extends ConvexError<{ code: string; message: string }> {
  public readonly code: string;
  constructor(code: string, message: string) {
    super({ code, message });
    this.name = "AccessError";
    this.code = code;
  }
}

// ── Audit helper ────────────────────────────────────────────
/** Only persists when ctx is a MutationCtx (read paths skip). */
async function audit(
  ctx: Ctx,
  viewer: Viewer | null,
  action: Capability,
  resource: ResourceRef | undefined,
  result: "allow" | "deny",
  reason?: string,
): Promise<void> {
  if (!SENSITIVE_CAPABILITIES.has(action)) return;
  // Only mutation contexts can insert. Detect by trying a runtime check.
  const db = ctx.db as unknown as { insert?: (table: string, doc: unknown) => Promise<unknown> };
  if (typeof db.insert !== "function") return;
  await (ctx as MutationCtx).db.insert("auditEvents", {
    agencyId: viewer && "agencyId" in viewer ? viewer.agencyId : undefined,
    orgId: viewer && "orgId" in viewer ? viewer.orgId : resource?.orgId,
    viewerType: viewer?.kind ?? "studio_member",
    viewerId: viewer
      ? viewer.kind === "guest"
        ? viewer.grantId
        : (viewer as AgencyViewer | StudioViewer).clerkUserId
      : "anonymous",
    action,
    resource: resource?.entityId,
    result,
    reason,
  });
}

// ── Capability-set builders ─────────────────────────────────
function buildAgencyCaps(role: AgencyRole, overrides?: string[]): Set<Capability> {
  return applyOverrides(AGENCY_ROLE_CAPABILITIES[role], overrides);
}

function buildStudioCaps(role: StudioRole, overrides?: string[]): Set<Capability> {
  return applyOverrides(STUDIO_ROLE_CAPABILITIES[role], overrides);
}

function buildGuestCaps(scope: GrantScope, extra?: string[]): Set<Capability> {
  return applyOverrides(GUEST_SCOPE_CAPABILITIES[scope], extra?.map((c) => "+" + c));
}

// ── resolveViewer ───────────────────────────────────────────
/**
 * Resolve the caller into a Viewer.
 * Order of checks:
 *   1. ctx.auth identity present -> look up agency or studio member
 *   2. no identity -> demo mode synthesizes a studio_member from appState
 * Guest-token resolution lands in cycle 2 via an HTTP action that
 * stamps a sessionless guest token into an appState row.
 */
export async function resolveViewer(ctx: Ctx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();

  // 1. Clerk-authenticated path
  if (identity) {
    const clerkUserId = identity.subject;
    const orgId = (identity as { orgId?: string }).orgId;
    const orgType = (identity as { orgType?: string }).orgType; // publicMetadata.type

    // Robust agency resolution: if this Clerk user has an active agencyMembers
    // row, they ARE an agency member - even when the token doesn't carry orgType
    // (e.g. no custom JWT template configured). This is the source of truth for
    // agency membership; the orgType check below is a legacy fast-path.
    const agMembership = (
      await ctx.db
        .query("agencyMembers")
        .withIndex("by_clerk", (q) => q.eq("clerkUserId", clerkUserId))
        .collect()
    ).find((m) => m.status === "active");
    if (agMembership) {
      let scoped: string[] | "all" = "all";
      if (agMembership.role === "staff") {
        const scopes = await ctx.db
          .query("agencyMemberScopes")
          .withIndex("by_member", (q) => q.eq("agencyMemberId", agMembership._id))
          .collect();
        scoped = scopes.map((s) => s.subAccountOrgId);
      }
      const state = await ctx.db
        .query("appState")
        .withIndex("by_key", (q) => q.eq("key", "demo"))
        .first();
      return {
        kind: "agency_member",
        agencyId: agMembership.agencyId,
        agencyMemberId: agMembership._id,
        clerkUserId,
        role: agMembership.role,
        scopedSubAccountOrgIds: scoped,
        capabilities: buildAgencyCaps(agMembership.role, agMembership.capabilityOverrides),
        // An agency member "acts as" a studio via appState.activeOrgId.
        orgId: state?.activeOrgId,
      };
    }

    // Agency-tier Clerk org (legacy fast-path; requires orgType in the JWT)
    if (orgId && orgType === "agency") {
      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency_clerk", (q) =>
          q.eq("agencyId", orgId).eq("clerkUserId", clerkUserId))
        .first();
      if (!member) throw new AccessError("NO_AGENCY_MEMBER", "No agencyMembers row for caller");
      let scoped: string[] | "all" = "all";
      if (member.role === "staff") {
        const scopes = await ctx.db
          .query("agencyMemberScopes")
          .withIndex("by_member", (q) => q.eq("agencyMemberId", member._id))
          .collect();
        scoped = scopes.map((s) => s.subAccountOrgId);
      }
      const state = await ctx.db
        .query("appState")
        .withIndex("by_key", (q) => q.eq("key", "demo"))
        .first();
      return {
        kind: "agency_member",
        agencyId: orgId,
        agencyMemberId: member._id,
        clerkUserId,
        role: member.role,
        scopedSubAccountOrgIds: scoped,
        capabilities: buildAgencyCaps(member.role, member.capabilityOverrides),
        orgId: state?.activeOrgId,
      };
    }

    // Studio-tier Clerk org (default)
    if (orgId) {
      const member = await ctx.db
        .query("members")
        .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
        .first();
      if (!member) throw new AccessError("NO_STUDIO_MEMBER", "No members row for caller");
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
      return {
        kind: "studio_member",
        orgId,
        agencyId: org?.agencyId,
        memberId: member._id,
        clerkUserId,
        role: member.role,
        capabilities: buildStudioCaps(member.role, member.capabilityOverrides),
      };
    }
  }

  // 2. No Clerk identity -> demo mode synthesizes an owner-level studio viewer
  //    pointed at appState.activeOrgId (or "pulse-demo" default).
  const state = await ctx.db
    .query("appState")
    .withIndex("by_key", (q) => q.eq("key", "demo"))
    .first();
  const demoOrgId = state?.activeOrgId ?? "pulse-demo";
  const demoOrg = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", demoOrgId)).first();
  return {
    kind: "studio_member",
    orgId: demoOrgId,
    agencyId: demoOrg?.agencyId,
    memberId: "demo" as unknown as StudioViewer["memberId"],
    clerkUserId: "demo-user",
    role: "owner",
    capabilities: buildStudioCaps("owner"),
  };
}

// ── requireCapability ───────────────────────────────────────
export async function requireCapability(
  ctx: Ctx,
  capability: Capability,
  resource?: ResourceRef,
): Promise<Viewer> {
  const viewer = await resolveViewer(ctx);

  // Capability check: accept exact match, or a `.own`-qualified variant of it
  const ok =
    viewer.capabilities.has(capability) ||
    viewer.capabilities.has(capability + ".own");
  if (!ok) {
    await audit(ctx, viewer, capability, resource, "deny", "missing capability");
    throw new AccessError("CAPABILITY_DENIED", `${viewer.kind} lacks ${capability}`);
  }

  // Scope/resource checks per viewer kind
  if (viewer.kind === "agency_member") {
    if (resource?.orgId) {
      // Org must belong to this agency
      const org = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", resource.orgId!))
        .first();
      if (!org || org.agencyId !== viewer.agencyId) {
        await audit(ctx, viewer, capability, resource, "deny", "org not under agency");
        throw new AccessError("SCOPE_DENIED", "Sub-account not under this agency");
      }
      // Staff additionally must have the sub-account in their scope list
      if (viewer.scopedSubAccountOrgIds !== "all"
          && !viewer.scopedSubAccountOrgIds.includes(resource.orgId)) {
        await audit(ctx, viewer, capability, resource, "deny", "out of staff scope");
        throw new AccessError("SCOPE_DENIED", "Sub-account out of staff scope");
      }
    }
  } else if (viewer.kind === "studio_member") {
    if (resource?.orgId && resource.orgId !== viewer.orgId) {
      await audit(ctx, viewer, capability, resource, "deny", "wrong org");
      throw new AccessError("SCOPE_DENIED", "Cross-org access denied");
    }
  } else if (viewer.kind === "guest") {
    if (Date.now() > viewer.expiresAt) {
      await audit(ctx, viewer, capability, resource, "deny", "grant expired");
      throw new AccessError("GRANT_EXPIRED", "Magic-link grant has expired");
    }
    if (resource?.entityId && resource.entityId !== viewer.entityId) {
      await audit(ctx, viewer, capability, resource, "deny", "guest wrong entity");
      throw new AccessError("SCOPE_DENIED", "Guest scope mismatch");
    }
  }

  await audit(ctx, viewer, capability, resource, "allow");
  return viewer;
}

// ── systemViewer ────────────────────────────────────────────
/**
 * Trusted internal viewer for system actions (Stripe webhooks, scheduled jobs).
 * Only callable from internalMutation / internalAction code paths.
 */
export function systemViewer(orgId?: string): StudioViewer {
  return {
    kind: "studio_member",
    orgId: orgId ?? "system",
    agencyId: undefined,
    memberId: "system" as unknown as StudioViewer["memberId"],
    clerkUserId: "system",
    role: "owner",
    capabilities: buildStudioCaps("owner"),
  };
}

export { audit, buildAgencyCaps, buildStudioCaps, buildGuestCaps };
