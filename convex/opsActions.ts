/* ============================================================
   Ops Autopilot - the approval queue + audited execution.

   `opsBrain` proposes actions; this module is how a human (or, for
   graduated types, the autopilot) acts on them. Execution runs through
   the same notify/email/session seams the rest of the product uses and
   always writes an activity + audit trail. Execution is idempotent:
   re-running an already-executed action is a no-op.
   ============================================================ */
import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, internalAction } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { invoicePayUrl } from "./lib/links";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { currentOrg, currentActor } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { sendEmail } from "./lib/email";
import { recordApprovalLearning, recordDismissLearning } from "./predictions";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Open queue for the active org: proposed actions plus snoozes that are due. */
export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("opsActions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(500);
    return rows
      .filter((r) => r.status === "proposed" || (r.status === "snoozed" && (r.snoozeUntil ?? 0) <= now))
      .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt - a.createdAt)
      .slice(0, limit ?? 30);
  },
});

/** Badge counts for the nav. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("opsActions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(500);
    const open = rows.filter((r) => r.status === "proposed" || (r.status === "snoozed" && (r.snoozeUntil ?? 0) <= now));
    return { open: open.length, high: open.filter((r) => r.priority === "high").length };
  },
});

/** Internal: fetch one action for the executor. */
export const getInternal = internalQuery({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/** Internal: apply an OpenAI-written draft to a still-open action. The rule
 * layer always seeds a deterministic fallback first; this upgrades the body
 * in place once the LLM responds. Skips actions a human has already acted on.
 *  - `body` rewrites an email payload's body (and subject when given).
 *  - `artifactId` links a rich aiArtifacts row (prep packet / recap / triage). */
export const applyEnrichment = internalMutation({
  args: {
    id: v.id("opsActions"),
    body: v.optional(v.string()),
    subject: v.optional(v.string()),
    rationale: v.optional(v.string()),
    artifactId: v.optional(v.id("aiArtifacts")),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { id, body, subject, rationale, artifactId, model }) => {
    const action = await ctx.db.get(id);
    if (!action) return;
    if (action.status !== "proposed" && action.status !== "snoozed") return; // human already acted
    const patch: Record<string, unknown> = { source: "openai" };
    if (model) patch.model = model;
    if (rationale) patch.rationale = rationale;
    if (artifactId) patch.artifactId = artifactId;
    if (body && action.payload.kind === "email") {
      patch.payload = { ...action.payload, body, ...(subject ? { subject } : {}) };
    }
    await ctx.db.patch(id, patch);
  },
});

/** Internal: gather the entity facts the LLM enricher needs for one action.
 * Returns null when the action is gone or already decided so the enricher can
 * cheaply skip it. Kept here (not aiContext) to respect file ownership. */
/** Uniform (all-optional) context shape so the Node enricher can read any
 * field without TS narrowing the union away. */
export type EnrichmentContext = {
  id: Id<"opsActions">;
  orgId: string;
  orgName: string;
  type: string;
  title: string;
  payloadKind: string;
  to?: string;
  subject?: string;
  fallbackBody?: string;
  payLink?: string; // direct invoice payment URL (payment_reminder)
  // artist
  artistName?: string;
  artistEmail?: string;
  genres?: string[];
  source?: string;
  // session
  session?: { title: string; serviceType: string; startTime: number; endTime: number; notes?: string };
  artistGenres?: string[];
  roomName?: string;
  engineerName?: string;
  gear?: string[];
  sampleRate?: string;
  bitDepth?: string;
  monitoring?: string;
  // song
  songTitle?: string;
  stage?: string;
  isrc?: string;
  iswc?: string;
  splitStatus?: string;
  openNotes?: { timestampSec: number; body: string; authorName: string }[];
};

export const enrichmentContext = internalQuery({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }): Promise<EnrichmentContext | null> => {
    const action = await ctx.db.get(id);
    if (!action) return null;
    if (action.status !== "proposed" && action.status !== "snoozed") return null;

    const orgRow = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", action.orgId))
      .first();

    const out: EnrichmentContext = {
      id,
      orgId: action.orgId,
      orgName: orgRow?.name ?? "the studio",
      type: action.type,
      title: action.title,
      payloadKind: action.payload.kind,
      to: action.payload.kind === "email" ? action.payload.to : undefined,
      subject: action.payload.kind === "email" ? action.payload.subject : undefined,
      fallbackBody: action.payload.kind === "email" ? action.payload.body : undefined,
    };

    // Artist-anchored actions.
    if (action.entityType === "artist" && action.entityId) {
      const artist = await ctx.db.get(action.entityId as Id<"artists">);
      out.artistName = artist?.name;
      out.artistEmail = artist?.email;
      out.genres = artist?.genres ?? [];
      out.source = artist?.source;
      return out;
    }

    // Invoice-anchored actions (payment reminders) - attach the pay link.
    if (action.entityType === "invoice" && action.entityId) {
      out.payLink = invoicePayUrl(action.entityId);
      return out;
    }

    // Session-anchored actions (prep packet, recap, no-show).
    if (action.entityType === "session" && action.entityId) {
      const session = await ctx.db.get(action.entityId as Id<"sessions">);
      if (!session) return out;
      const [artist, song, room, engineer, log] = await Promise.all([
        ctx.db.get(session.artistId),
        session.songId ? ctx.db.get(session.songId) : null,
        session.roomId ? ctx.db.get(session.roomId) : null,
        session.engineerId ? ctx.db.get(session.engineerId) : null,
        ctx.db.query("engineeringLogs").withIndex("by_session", (q) => q.eq("sessionId", session._id)).first(),
      ]);
      let gear: string[] = [];
      if (session.roomId) {
        const rows = await ctx.db
          .query("equipment")
          .withIndex("by_org_room", (q) => q.eq("orgId", action.orgId).eq("installedInRoomId", session.roomId))
          .collect();
        gear = rows.map((g) => g.name).slice(0, 8);
      }
      out.session = {
        title: session.title,
        serviceType: session.serviceType,
        startTime: session.startTime,
        endTime: session.endTime,
        notes: session.notes,
      };
      out.artistName = artist?.name;
      out.artistEmail = artist?.email;
      out.artistGenres = artist?.genres ?? [];
      out.songTitle = song?.title;
      out.roomName = room?.name;
      out.engineerName = engineer?.name;
      out.gear = gear;
      out.sampleRate = log?.sampleRate;
      out.bitDepth = log?.bitDepth;
      out.monitoring = log?.monitoring;
      return out;
    }

    // Song-anchored actions (revision triage, rights metadata, split sheet).
    if (action.entityType === "song" && action.entityId) {
      const song = await ctx.db.get(action.entityId as Id<"songs">);
      if (!song) return out;
      const comments = await ctx.db
        .query("revisionComments")
        .withIndex("by_song", (q) => q.eq("songId", song._id))
        .collect();
      out.openNotes = comments
        .filter((c) => !c.resolved)
        .sort((a, b) => a.timestampSec - b.timestampSec)
        .slice(0, 30)
        .map((c) => ({ timestampSec: c.timestampSec, body: c.body, authorName: c.authorName }));
      const sheet = await ctx.db
        .query("splitSheets")
        .withIndex("by_song", (q) => q.eq("songId", song._id))
        .first();
      out.songTitle = song.title;
      out.stage = song.stage;
      out.isrc = song.isrc;
      out.iswc = song.iswc;
      out.splitStatus = sheet?.status;
      return out;
    }

    return out;
  },
});

/** Bump the per-type trust counters that drive autonomy graduation. */
async function bumpTrust(ctx: MutationCtx, orgId: string, actionType: string, kind: "approved" | "dismissed") {
  const row = await ctx.db
    .query("opsAutonomy")
    .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("actionType", actionType))
    .first();
  if (!row) {
    await ctx.db.insert("opsAutonomy", {
      orgId,
      actionType,
      mode: "manual",
      approvedCount: kind === "approved" ? 1 : 0,
      dismissedCount: kind === "dismissed" ? 1 : 0,
    });
    return;
  }
  await ctx.db.patch(row._id, {
    approvedCount: row.approvedCount + (kind === "approved" ? 1 : 0),
    dismissedCount: row.dismissedCount + (kind === "dismissed" ? 1 : 0),
  });
}

/** Approve a queued action -> schedule execution. Accepts an optional
 * user-edited body: the inbox lets staff tweak the AI draft before it sends.
 * The edit is persisted to `editedBody` and used as the sent email body. */
export const approve = mutation({
  args: { id: v.id("opsActions"), editedBody: v.optional(v.string()) },
  handler: async (ctx, { id, editedBody }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    if (action.status !== "proposed" && action.status !== "snoozed") {
      throw new Error(`Cannot approve an action that is ${action.status}`);
    }
    const actor = await currentActor(ctx);

    // If the user edited the draft, persist it and fold it into the payload so
    // the executor sends exactly what they approved.
    const trimmed = editedBody?.trim();
    const patch: Record<string, unknown> = { status: "approved", decidedAt: Date.now(), decidedBy: actor };
    if (trimmed) {
      patch.editedBody = trimmed;
      if (action.payload.kind === "email" && trimmed !== action.payload.body) {
        patch.payload = { ...action.payload, body: trimmed };
      }
    }

    await ctx.db.patch(id, patch);
    await bumpTrust(ctx, action.orgId, action.type, "approved");
    // Learning loop: an owner edit becomes a style note the enricher reuses.
    await recordApprovalLearning(ctx, action, trimmed);
    await ctx.scheduler.runAfter(0, internal.opsActions.execute, { id });
  },
});

/** Dismiss a queued action. */
export const dismiss = mutation({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    const actor = await currentActor(ctx);
    await ctx.db.patch(id, { status: "dismissed", decidedAt: Date.now(), decidedBy: actor });
    await bumpTrust(ctx, action.orgId, action.type, "dismissed");
    await recordDismissLearning(ctx, action);
  },
});

/** Snooze a queued action until a later time. */
export const snooze = mutation({
  args: { id: v.id("opsActions"), until: v.number() },
  handler: async (ctx, { id, until }) => {
    const action = await ctx.db.get(id);
    if (!action) throw new Error("Not found");
    await requireCapability(ctx, "ops.action.approve", { orgId: action.orgId, entityId: id });
    await ctx.db.patch(id, { status: "snoozed", snoozeUntil: until });
  },
});

/** Internal: execute an approved action. Idempotent; fully audited. */
export const execute = internalAction({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const action = await ctx.runQuery(internal.opsActions.getInternal, { id });
    if (!action || action.status === "executed") return;
    let emailStatus: "sent" | "failed" | "simulated" | undefined;
    if (action.payload.kind === "email" && action.payload.to) {
      emailStatus = await sendEmail({
        to: action.payload.to,
        subject: action.payload.subject,
        html: `<p>${escapeHtml(action.payload.body)}</p>`,
      });
    }
    await ctx.runMutation(internal.opsActions.finalize, { id, emailStatus });
  },
});

/** Internal: record execution side effects + audit, flip status. */
export const finalize = internalMutation({
  args: {
    id: v.id("opsActions"),
    emailStatus: v.optional(v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated"))),
  },
  handler: async (ctx, { id, emailStatus }) => {
    const action = await ctx.db.get(id);
    if (!action || action.status === "executed") return;

    let result = "noted";
    const p = action.payload;
    if (p.kind === "email") {
      await ctx.db.insert("notifications", {
        orgId: action.orgId,
        channel: "email",
        recipient: p.to ?? "",
        subject: p.subject,
        body: p.body,
        kind: p.notifyKind,
        status: emailStatus ?? "simulated",
      });
      // Mirror an autopilot email onto the client's own Messages thread so the
      // record shows every email - human-sent or AI-sent - in one place.
      if (action.entityType === "artist" && action.entityId) {
        const artistId = ctx.db.normalizeId("artists", action.entityId);
        const artist = artistId ? await ctx.db.get(artistId) : null;
        if (artist && artist.orgId === action.orgId) {
          await ctx.db.insert("clientMessages", {
            orgId: action.orgId,
            artistId: artist._id,
            direction: "out",
            subject: p.subject,
            body: p.body,
            channel: "internal",
            status: emailStatus ?? "simulated",
            sentBy: action.decidedBy ?? "Autopilot",
          });
        }
      }
      result = `email ${emailStatus ?? "simulated"} to ${p.to ?? "n/a"}`;
    } else if (p.kind === "session_status") {
      const session = await ctx.db.get(p.sessionId);
      if (session && session.orgId === action.orgId) {
        await ctx.db.patch(p.sessionId, { status: p.newStatus });
        result = `session -> ${p.newStatus}`;
      } else {
        result = "session not found";
      }
    }

    await ctx.db.insert("activity", {
      orgId: action.orgId,
      kind: `ops.${action.type}`,
      summary: `Autopilot: ${action.title}`,
      actorName: action.decidedBy ?? "Autopilot",
      entityType: action.entityType,
      entityId: action.entityId,
      accent: "gold",
    });
    await ctx.db.insert("auditEvents", {
      orgId: action.orgId,
      viewerType: "studio_member",
      viewerId: action.decidedBy ?? "autopilot",
      action: `ops.execute.${action.type}`,
      resource: id,
      result: "allow",
      reason: action.autonomy ? "autopilot" : "approved",
    });
    await ctx.db.patch(id, { status: "executed", executedAt: Date.now(), result });
  },
});

/* ============================================================
   Autonomy graduation (Phase 3)
   ============================================================ */

/** Action types the owner could safely graduate to auto-execute:
 * approved >= 5 times with a low dismiss rate, still in manual mode. */
export const suggestions = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("opsAutonomy")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows
      .filter((r) => {
        const total = r.approvedCount + r.dismissedCount;
        return r.mode === "manual" && r.approvedCount >= 5 && total > 0 && r.dismissedCount / total < 0.2;
      })
      .map((r) => ({ actionType: r.actionType, approvedCount: r.approvedCount, dismissedCount: r.dismissedCount }));
  },
});

/** Flip an action type between manual and auto. */
export const setMode = mutation({
  args: { actionType: v.string(), mode: v.union(v.literal("manual"), v.literal("auto")) },
  handler: async (ctx, { actionType, mode }) => {
    const orgId = await currentOrg(ctx);
    await requireCapability(ctx, "ops.autonomy.manage", { orgId });
    const row = await ctx.db
      .query("opsAutonomy")
      .withIndex("by_org_type", (q) => q.eq("orgId", orgId).eq("actionType", actionType))
      .first();
    if (row) await ctx.db.patch(row._id, { mode });
    else await ctx.db.insert("opsAutonomy", { orgId, actionType, mode, approvedCount: 0, dismissedCount: 0 });
  },
});
