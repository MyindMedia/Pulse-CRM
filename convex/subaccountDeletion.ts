import { query, internalQuery } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCapability } from "./lib/access";
import type { Id } from "./_generated/dataModel";

/* ============================================================
   Deleting a sub-account.

   This destroys a real business's records. It is built to be hard to
   do by accident and impossible to do quietly:

     1. `impact` shows exactly what will be destroyed, counted from
        the live data rather than described in the abstract.
     2. `requestDeletion` opens a short-lived window and returns a
        one-time token. Nothing is deleted here.
     3. `confirmDeletion` needs that token, the studio's exact name
        retyped, and the literal word DELETE. Any mismatch aborts.

   Two things are deliberately NOT deleted: the `auditEvents` trail,
   and the record written here of what was destroyed and by whom.
   A deletion that erases its own evidence is not a feature.
   ============================================================ */

/** Every table a studio owns. Kept explicit rather than derived, so adding a
 *  table is a deliberate decision about whether it dies with the workspace. */
export const ORG_TABLES = [
  // The price list outlived deletion too.
  "bookableServices",
  "collaboratorGrants", "invites", "agentPolicies", "agentRuns", "agentMessages",
  "agentInsights", "agentApprovals", "agentUsage", "agentAuditLogs", "agentAutomations",
  "agentMemories", "studioGraphNodes", "studioGraphEdges", "studioJournal", "oauthStates",
  "members", "artists", "arrivalPrep", "pushSubscriptions", "pushAlerts", "visitors",
  "songs", "rooms", "equipment", "assetDocuments", "sessions", "payments", "notifications",
  "engineeringLogs", "deliverables", "revisionComments", "splitSheets", "demoRows",
  "invoices", "feeTemplates", "packageProducts", "packageCredits", "reviews",
  "recoveryEvents", "expenses", "softwareLicenses", "opportunities", "syncOpportunities",
  "releaseCampaigns", "licenses", "activity", "insights", "aiArtifacts", "sessionChecklists",
  "externalCalendars", "externalCalendarEvents", "googleBusyBlocks", "opsActions",
  "opsAutonomy", "agentRules", "payouts", "bookingVisits", "usageCounters", "shifts",
  "timeEntries", "smsPrompts", "availability", "timeOff", "clientMessages", "waitlistEntries",
  "membershipPlans", "memberships", "patchSpaces", "deviceInstances", "patchVocabGaps",
  "patchAnnotations", "patchGroups", "ports", "connections", "patchAudit",
  // Last on purpose. Every delete above fires a trigger that appends here, so
  // sweeping the feed first would leave a fresh activity trace - orgId, table,
  // docId, timestamps - of a workspace that was told it was destroyed.
  "changeLog",
] as const;

/** How long a confirmation token stays good. Long enough to read the warning,
 *  short enough that a forgotten open tab cannot delete anything tomorrow. */
const TOKEN_TTL_MS = 10 * 60_000;

const CONFIRM_PHRASE = "DELETE";

async function orgOrThrow(ctx: MutationCtx, orgId: string) {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Subaccount not found." });
  return org;
}

/** Step 1. What deleting this workspace actually destroys. */
export const impact = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.delete", { orgId });
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return null;

    // The counts people actually weigh the decision on. Not every table -
    // a list of seventy numbers is not a warning, it is wallpaper.
    const [sessions, artists, invoices, payments, members, rooms, songs, deliverables] =
      await Promise.all([
        ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
        ctx.db.query("deliverables").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);

    const collectedCents = payments
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + p.amountCents, 0);
    const unpaidCents = invoices
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + i.amountCents, 0);
    const upcoming = sessions.filter(
      (s) => s.startTime > Date.now() && s.status !== "cancelled",
    ).length;

    return {
      orgId,
      name: org.name,
      slug: org.slug,
      createdAt: org._creationTime,
      counts: {
        sessions: sessions.length,
        upcomingSessions: upcoming,
        clients: artists.length,
        invoices: invoices.length,
        payments: payments.length,
        team: members.length,
        rooms: rooms.length,
        songs: songs.length,
        deliverables: deliverables.length,
      },
      money: { collectedCents, unpaidCents },
      // The things that make this worse than it looks.
      warnings: [
        upcoming > 0 && `${upcoming} session${upcoming === 1 ? "" : "s"} are still on the calendar.`,
        unpaidCents > 0 && `$${(unpaidCents / 100).toFixed(2)} is still owed on open invoices.`,
        deliverables.length > 0 && `${deliverables.length} client file${deliverables.length === 1 ? "" : "s"} will be unreachable.`,
        org.betaCohort && "This is a beta-cohort studio. Consider pausing it instead.",
      ].filter(Boolean) as string[],
      confirmPhrase: CONFIRM_PHRASE,
    };
  },
});


/* Ops read: what is actually inside one workspace, table by table, and how
   much of it the demo filler put there.

   Internal, because it is run from the CLI where there is no Clerk identity -
   the console has `impact` for the same question. Read-only, and it exists so
   that "wipe the demo data" can be preceded by looking at what is there and
   followed by proving what left. */
export const _orgContent = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return null;

    const demoRows = await ctx.db
      .query("demoRows")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const demoByTable: Record<string, number> = {};
    for (const r of demoRows) demoByTable[r.table] = (demoByTable[r.table] ?? 0) + 1;

    const counts: Record<string, number> = {};
    for (const table of ORG_TABLES) {
      const n = (await orgRows(ctx, table, orgId)).length;
      if (n > 0) counts[table] = n;
    }

    return {
      name: org.name,
      slug: org.slug,
      demoMode: Boolean(org.demoMode),
      onboardingCompletedAt: org.onboardingCompletedAt ?? null,
      demoRowTotal: demoRows.length,
      demoByTable,
      counts,
    };
  },
});

/** Step 2. Open a confirmation window. Deletes nothing. */
export const requestDeletion = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const viewer = await requireCapability(ctx, "agency.subaccount.delete", { orgId });
    const org = await orgOrThrow(ctx, orgId);
    const now = Date.now();
    // The token binds the confirmation to this request, this workspace and
    // this person, so a stale tab cannot confirm a different deletion.
    const token = `del_${orgId}_${now.toString(36)}_${Math.abs(
      hash(`${orgId}:${now}:${"clerkUserId" in viewer ? viewer.clerkUserId : "anon"}`),
    ).toString(36)}`;

    await ctx.db.patch(org._id, {
      pendingDeletion: {
        token,
        requestedAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        requestedBy: "clerkUserId" in viewer ? viewer.clerkUserId : undefined,
      },
    });
    return { token, expiresAt: now + TOKEN_TTL_MS, name: org.name };
  },
});

export const cancelDeletion = mutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.subaccount.delete", { orgId });
    const org = await orgOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, { pendingDeletion: undefined });
  },
});

/** Step 3. Destroy it. Needs the token, the exact name, and the phrase. */
export const confirmDeletion = mutation({
  args: {
    orgId: v.string(),
    token: v.string(),
    typedName: v.string(),
    typedPhrase: v.string(),
  },
  handler: async (ctx, { orgId, token, typedName, typedPhrase }) => {
    const viewer = await requireCapability(ctx, "agency.subaccount.delete", { orgId });
    const org = await orgOrThrow(ctx, orgId);

    const pending = org.pendingDeletion;
    if (!pending || pending.token !== token) {
      throw new ConvexError({
        code: "NO_REQUEST",
        message: "Start the deletion again. That confirmation is not valid.",
      });
    }
    if (pending.expiresAt < Date.now()) {
      await ctx.db.patch(org._id, { pendingDeletion: undefined });
      throw new ConvexError({
        code: "EXPIRED",
        message: "That confirmation timed out. Start again if you still mean it.",
      });
    }
    // Exact match, not trimmed-and-lowercased: retyping the name is the point.
    if (typedName !== org.name) {
      throw new ConvexError({
        code: "NAME_MISMATCH",
        message: `That does not match. Type the studio's name exactly: ${org.name}`,
      });
    }
    if (typedPhrase.trim().toUpperCase() !== CONFIRM_PHRASE) {
      throw new ConvexError({
        code: "PHRASE_MISMATCH",
        message: `Type ${CONFIRM_PHRASE} to confirm.`,
      });
    }

    // Write the evidence BEFORE destroying anything, so a failure partway
    // through still leaves a record that this was attempted and by whom.
    await ctx.db.insert("auditEvents", {
      agencyId: org.agencyId,
      orgId,
      viewerType: viewer.kind,
      viewerId: "clerkUserId" in viewer ? viewer.clerkUserId : "anonymous",
      action: "agency.subaccount.delete",
      resource: orgId,
      result: "allow",
      reason: `Deleted "${org.name}" (/${org.slug}) after three-step confirmation`,
    });

    let deleted = 0;
    for (const table of ORG_TABLES) {
      const rows = await orgRows(ctx, table, orgId);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }

    // Detach the beta invite rather than deleting it: the signature record
    // outlives the workspace on purpose.
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_claimed_org", (q) => q.eq("claimedOrgId", orgId))
      .first();
    if (invite) {
      await ctx.db.patch(invite._id, {
        claimedOrgId: undefined,
        claimedSlug: undefined,
        status: "signed",
        note: `${invite.note ? invite.note + " · " : ""}Workspace deleted ${new Date().toISOString().slice(0, 10)}`,
      });
    }

    await ctx.db.delete(org._id);
    return { deletedRows: deleted + 1, name: org.name };
  },
});

/**
 * Tables that carry an `orgId` but have NO `by_org` index. They are read with
 * a filter instead. Listed explicitly rather than discovered by catching an
 * error, so the cost is visible: each of these is a full-table read, and the
 * fix for any of them is to add the index, not to grow this list.
 */
const NO_ORG_INDEX = new Set<string>([
  "agentMessages", "agentUsage", "oauthStates", "arrivalPrep",
  "pushAlerts", "bookingVisits", "smsPrompts", "patchAudit",
]);

/**
 * Rows one studio owns in one table.
 *
 * The cast is localized here rather than sprayed across the loop. TypeScript
 * cannot type this generically: indexing a union of table names resolves to
 * the INTERSECTION of their index names, which is empty. "sessions" stands in
 * for "any table in ORG_TABLES" - they all share the shape this touches, an
 * `_id` and an `orgId`.
 */
export async function orgRows(
  ctx: QueryCtx,
  table: (typeof ORG_TABLES)[number],
  orgId: string,
  /** Stop after this many. A workspace can hold more rows than one Convex
   *  transaction may read, so callers that delete work in batches. */
  limit?: number,
): Promise<{ _id: Id<"sessions"> }[]> {
  const q = ctx.db.query(table as "sessions");
  const scoped = NO_ORG_INDEX.has(table)
    ? q.filter((f) => f.eq(f.field("orgId"), orgId))
    : q.withIndex("by_org", (ix) => ix.eq("orgId", orgId));
  return limit === undefined ? await scoped.collect() : await scoped.take(limit);
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
