import type { CapabilityKey } from "./pricing";
import type { Id } from "../_generated/dataModel";

/* ============================================================
   Shared type vocabulary for the Access Engine. All capability
   strings live in access-policies.ts; this file is just the
   shape contracts.
   ============================================================ */

export type AgencyRole = "owner" | "admin" | "staff" | "billing";

export type StudioRole =
  | "owner"
  | "manager"
  | "engineer"
  | "assistant_engineer"
  | "artist_relations"
  | "producer"
  | "intern"
  | "accountant";

export type GrantScope =
  | "session"
  | "song"
  | "deliverable"
  | "splitsheet"
  | "artist_portal";

/** Dot-namespaced capability string: <module>.<action>. */
export type Capability = string;

export type ResourceRef = {
  orgId?: string;
  entityId?: string;
  entityType?: string;
  /** Entitlement to check instead of the one mapped from the permission in
   *  ENTITLEMENT_FOR_CAPABILITY. For a call site whose permission is shared
   *  with a surface sold at a different tier (software vs licensing, the
   *  cable map's Max adds). null means unmetered. */
  entitlement?: CapabilityKey | null;
};

export type AgencyViewer = {
  kind: "agency_member";
  agencyId: string;
  agencyMemberId: Id<"agencyMembers">;
  clerkUserId: string;
  role: AgencyRole;
  scopedSubAccountOrgIds: string[] | "all";
  capabilities: Set<Capability>;
  orgId?: string; // active sub-account (from appState.activeOrgId)
};

export type StudioViewer = {
  kind: "studio_member";
  orgId: string;
  agencyId?: string;
  memberId: Id<"members">;
  clerkUserId: string;
  role: StudioRole;
  capabilities: Set<Capability>;
};

export type GuestViewer = {
  kind: "guest";
  grantId: Id<"collaboratorGrants">;
  orgId: string;
  agencyId?: string;
  scope: GrantScope;
  entityId: string;
  capabilities: Set<Capability>;
  expiresAt: number;
};

export type Viewer = AgencyViewer | StudioViewer | GuestViewer;
