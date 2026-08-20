import type { AgencyRole, StudioRole, GrantScope, Capability } from "./accessTypes";

/* ============================================================
   Capability policy map - the single source of truth for what
   each role can do. Edits here = behavior change everywhere.
   Capability strings are <module>.<action>; "own" qualifier is
   handled by the engine (viewer.scopedSubAccountOrgIds, etc.).
   ============================================================ */

// ── Agency layer (4 roles) ──────────────────────────────────
export const AGENCY_ROLE_CAPABILITIES: Record<AgencyRole, ReadonlyArray<Capability>> = {
  owner: [
    "agency.subaccount.create",
    "agency.subaccount.pause",
    "agency.subaccount.delete",
    "agency.staff.invite",
    "agency.staff.scope",
    "agency.viewAll",
    "billing.read",
    "billing.edit",
    "branding.edit",
    "theme.edit",
    "act_as_studio",
    "audit.read",
    "ops.portfolio.view",
    // Acting as a studio (act_as_studio) - full studio operations on their own
    // sub-accounts (scope enforced by requireCapability's agency org check).
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "patch.read", "patch.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite", "members.remove",
    "schedule.manage",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "ops.action.approve",
    "ops.autonomy.manage",
    "activity.read",
  ],
  admin: [
    "agency.subaccount.create",
    "agency.subaccount.pause",
    "agency.staff.invite",
    "agency.staff.scope",
    "agency.viewAll",
    "billing.read",
    "branding.edit",
    "theme.edit",
    "act_as_studio",
    "audit.read",
    "ops.portfolio.view",
    // Acting as a studio - full studio operations on their own sub-accounts.
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "patch.read", "patch.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite",
    "schedule.manage",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "ops.action.approve",
    "activity.read",
  ],
  staff: [
    "agency.subaccount.pause",       // scoped - engine enforces by sub-account list
    "act_as_studio",                  // scoped - same
  ],
  billing: [
    "billing.read",
    "billing.edit",
  ],
};

// ── Studio layer (8 roles) ──────────────────────────────────
//   "own" cells in the spec matrix become a per-capability qualifier
//   handled inside requireCapability (compares assigned member id).
//   This list is the positive grant set; everything not listed is denied.
export const STUDIO_ROLE_CAPABILITIES: Record<StudioRole, ReadonlyArray<Capability>> = {
  owner: [
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "patch.read", "patch.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite", "members.remove",
    "schedule.manage",
    "branding.edit",
    "theme.edit",
    "grants.issue", "grants.revoke",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "ops.action.approve",
    "ops.autonomy.manage",
    "activity.read",
  ],
  manager: [
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "patch.read", "patch.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite",
    "schedule.manage",
    "branding.edit",
    "theme.edit",
    "grants.issue", "grants.revoke",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "ops.action.approve",
    "activity.read",
  ],
  engineer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    // Engineers patch the room for a living, so they own the patch document
    // even though the asset register itself stays read-only for them.
    "patch.read", "patch.edit",
    "grants.issue",
    "grants.revoke.own",
    // No "insights.read" - exec/revenue analytics are leadership-only
    // (owner / manager / accountant). Engineers see operations, not the books.
    "activity.read",
  ],
  assistant_engineer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit.own",
    "deliverables.read", "deliverables.upload",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "patch.read", "patch.edit",
    "activity.read",
  ],
  artist_relations: [
    "songs.read",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read",
    "splitsheet.read",
    "artists.read", "artists.edit",
    // No "invoices.read" - financial visibility is leadership-only
    // (owner / manager / accountant). AR handles relationships, not the books.
    "grants.issue",
    "grants.revoke.own",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "activity.read",
  ],
  producer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "patch.read", "patch.edit",
    "grants.issue",
    "grants.revoke.own",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "activity.read",
  ],
  intern: [
    "songs.read",
    "sessions.read",
    "deliverables.read",
    "engineeringLogs.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    // Read only. An intern can trace a signal path but cannot repatch the map.
    "patch.read",
    "activity.read",
  ],
  accountant: [
    "songs.read",
    "sessions.read",
    "deliverables.read",
    "artists.read",
    "invoices.read", "invoices.send",
    "finance.refund",
    "licenses.read", "licenses.edit",
    "insights.read",   // finance role sees revenue analytics / Reports
    "activity.read",
  ],
};

// ── Guest grant scopes (5) ──────────────────────────────────
export const GUEST_SCOPE_CAPABILITIES: Record<GrantScope, ReadonlyArray<Capability>> = {
  session: [
    "sessions.read",
    "engineeringLogs.read",
    "deliverables.read",
  ],
  song: [
    "songs.read",
    "deliverables.read", "deliverables.upload",
    "engineeringLogs.read",
    "revisionComments.write",
  ],
  deliverable: [
    "deliverables.read", "deliverables.approve",
    "revisionComments.write",
  ],
  splitsheet: [
    "splitsheet.read", "splitsheet.sign",
  ],
  artist_portal: [
    "songs.read",
    "sessions.read",
    "deliverables.read", "deliverables.approve",
    "invoices.read",
    "revisionComments.write",
  ],
};

/** Capabilities whose grants/denies get audited. Keep tight to avoid noise. */
export const SENSITIVE_CAPABILITIES = new Set<Capability>([
  "agency.subaccount.create",
  "agency.subaccount.pause",
  "agency.subaccount.delete",
  "agency.staff.invite",
  "agency.staff.scope",
  "billing.edit",
  "branding.edit",
  "theme.edit",
  "members.invite",
  "members.remove",
  "songs.delete",
  "deliverables.approve",
  "splitsheet.sign",
  "finance.refund",
  "grants.issue",
  "grants.revoke",
  "ops.action.approve",
  "ops.autonomy.manage",
]);

/** Default magic-link expiry windows per scope, in ms. */
export const GUEST_SCOPE_DEFAULT_TTL_MS: Record<GrantScope, number> = {
  session: 14 * 24 * 60 * 60 * 1000,
  song: 30 * 24 * 60 * 60 * 1000,
  deliverable: 7 * 24 * 60 * 60 * 1000,
  splitsheet: 30 * 24 * 60 * 60 * 1000,
  artist_portal: 365 * 24 * 60 * 60 * 1000,
};

// ── Override token application ──────────────────────────────
/** Apply `+cap` / `-cap` tokens to a base set. */
export function applyOverrides(
  base: ReadonlyArray<Capability>,
  overrides: ReadonlyArray<string> | undefined,
): Set<Capability> {
  const set = new Set<Capability>(base);
  if (!overrides) return set;
  for (const tok of overrides) {
    if (tok.startsWith("+")) set.add(tok.slice(1));
    else if (tok.startsWith("-")) set.delete(tok.slice(1));
  }
  return set;
}
