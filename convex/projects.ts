import { query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { requireCapability, resolveViewer, AccessError } from "./lib/access";
import type { Viewer } from "./lib/accessTypes";
import { orgGate } from "./lib/tier";
import { migrateTierValue } from "./lib/legacyPlans";
import { capabilitiesForTier, upgradeError } from "./lib/entitlements";
import { notifyTeam } from "./lib/notify";
import {
  PROJECT_LINK_KINDS,
  PROJECT_STAGES,
  projectLinkKindV,
  projectStageV,
  type ProjectLinkKind,
  type ProjectStage,
} from "./projectsTables";

/* ============================================================
   Post-production project tracking.

   A project is the record after the room: tracking, editing, mixing,
   mastering, delivery. It has tasks (owner, due date), and links to the
   sessions, songs, rooms, engineers, bills and deliverables it touches.

   Rules every function here follows:
     - The org comes from the signed-in viewer, never from an argument.
     - One permission check per function: requireCapability("projects.read"
       or "projects.edit"). It checks the person AND the workspace's tier
       (projects is Growth, see lib/pricing.ts CAPABILITY_TIER).
     - Every id a caller passes is loaded and its orgId compared to the
       caller's before it is read or written.
     - Row changes reach the change log and the phone through the mirror
       triggers in functions.ts (projects, projectTasks, projectLinks are
       in lib/mirroredTables.ts).
   ============================================================ */

const DAY = 86_400_000;
const DUE_SOON_MS = DAY;

type Ctx = QueryCtx | MutationCtx;

/** Stage index, for ordering and for "is this a step forward". */
export function stageIndex(stage: ProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

/** The song stage a project stage drives. `complete` leaves the song alone. */
export const SONG_STAGE_FOR_PROJECT_STAGE: Partial<Record<ProjectStage, Doc<"songs">["stage"]>> = {
  tracking: "tracking",
  editing: "editing",
  mixing: "mixing",
  mastering: "mastering",
  delivery: "delivered",
};

/** Song stages a project must never pull backwards. */
const SONG_STAGE_ORDER: Doc<"songs">["stage"][] = [
  "writing", "demo", "tracking", "editing", "mixing", "mastering", "delivered", "released",
];

/** The org and viewer for a project call. One permission check. An agency
 *  viewer who has not entered a studio has no workspace and is refused,
 *  rather than falling back to some default org. */
async function scope(
  ctx: Ctx,
  capability: "projects.read" | "projects.edit",
): Promise<{ orgId: string; viewer: Viewer }> {
  const viewer = await requireCapability(ctx, capability);
  if (!viewer.orgId) throw new AccessError("NO_WORKSPACE", "Pick a studio first.");
  return { orgId: viewer.orgId, viewer };
}

async function ownProject(ctx: Ctx, orgId: string, id: Id<"projects">): Promise<Doc<"projects">> {
  const p = await ctx.db.get(id);
  if (!p || p.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
  return p;
}

async function ownTask(ctx: Ctx, orgId: string, id: Id<"projectTasks">): Promise<Doc<"projectTasks">> {
  const t = await ctx.db.get(id);
  if (!t || t.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Task not found." });
  return t;
}

async function assertMember(ctx: Ctx, orgId: string, id: Id<"members"> | null | undefined) {
  if (!id) return;
  const m = await ctx.db.get(id);
  if (!m || m.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Teammate not found." });
}

async function assertSong(ctx: Ctx, orgId: string, id: Id<"songs"> | null | undefined) {
  if (!id) return;
  const s = await ctx.db.get(id);
  if (!s || s.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Song not found." });
}

function cleanTitle(raw: string, what: string): string {
  const t = raw.trim();
  if (!t) throw new ConvexError({ code: "INVALID", message: `${what} needs a name.` });
  return t.slice(0, 160);
}

/** Resolve a link target inside this org. Returns the display label, or null
 *  when the id is not a row of that kind in this org. The wrong table and the
 *  wrong org are the same answer, so nothing leaks. */
async function resolveLinkTarget(
  ctx: Ctx,
  orgId: string,
  kind: ProjectLinkKind,
  refId: string,
): Promise<{ label: string; normalizedId: string } | null> {
  switch (kind) {
    case "session": {
      const id = ctx.db.normalizeId("sessions", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.title, normalizedId: d._id } : null;
    }
    case "song": {
      const id = ctx.db.normalizeId("songs", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.title, normalizedId: d._id } : null;
    }
    case "room": {
      const id = ctx.db.normalizeId("rooms", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.name, normalizedId: d._id } : null;
    }
    case "engineer": {
      const id = ctx.db.normalizeId("members", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.name, normalizedId: d._id } : null;
    }
    case "invoice": {
      const id = ctx.db.normalizeId("invoices", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: `Invoice ${d.number}`, normalizedId: d._id } : null;
    }
    case "deliverable": {
      const id = ctx.db.normalizeId("deliverables", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.label, normalizedId: d._id } : null;
    }
    case "opportunity": {
      const id = ctx.db.normalizeId("opportunities", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.title, normalizedId: d._id } : null;
    }
    case "artist": {
      const id = ctx.db.normalizeId("artists", refId);
      const d = id ? await ctx.db.get(id) : null;
      return d && d.orgId === orgId ? { label: d.name, normalizedId: d._id } : null;
    }
  }
}

async function insertLink(
  ctx: MutationCtx,
  orgId: string,
  projectId: Id<"projects">,
  kind: ProjectLinkKind,
  refId: string,
): Promise<Id<"projectLinks">> {
  const target = await resolveLinkTarget(ctx, orgId, kind, refId);
  if (!target) throw new ConvexError({ code: "NOT_FOUND", message: "That item is not in this studio." });
  const existing = await ctx.db
    .query("projectLinks")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const dupe = existing.find((l) => l.kind === kind && l.refId === target.normalizedId);
  if (dupe) return dupe._id;
  return ctx.db.insert("projectLinks", {
    orgId,
    projectId,
    kind,
    refId: target.normalizedId,
    label: target.label,
    createdAt: Date.now(),
  });
}

/** Card shape shared by the board, the Today card and the cross-studio view. */
function cardOf(
  p: Doc<"projects">,
  tasks: Doc<"projectTasks">[],
  ownerName: string | null,
  linkCount: number,
  now: number,
) {
  const open = tasks.filter((t) => !t.done);
  const overdueTasks = open.filter((t) => t.dueDate !== undefined && t.dueDate < now);
  const next = [...open]
    .filter((t) => t.dueDate !== undefined)
    .sort((a, b) => a.dueDate! - b.dueDate!)[0];
  const finished = p.stage === "complete";
  return {
    _id: p._id,
    name: p.name,
    stage: p.stage,
    dueDate: p.dueDate ?? null,
    overdue: !finished && p.dueDate !== undefined && p.dueDate < now,
    ownerMemberId: p.ownerMemberId ?? null,
    ownerName,
    songId: p.songId ?? null,
    taskCount: tasks.length,
    openTaskCount: open.length,
    overdueTaskCount: finished ? 0 : overdueTasks.length,
    linkCount,
    nextTask: next ? { title: next.title, dueDate: next.dueDate ?? null } : null,
    updatedAt: p.updatedAt,
  };
}

async function ownerNames(ctx: Ctx, projects: Doc<"projects">[]): Promise<Map<string, string>> {
  const ids = [...new Set(projects.map((p) => p.ownerMemberId).filter((x): x is Id<"members"> => !!x))];
  const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return new Map(rows.filter((m): m is Doc<"members"> => !!m).map((m) => [m._id as string, m.name]));
}

/** Cards for one org's live projects. Read-only; the caller has been checked. */
async function cardsForOrg(ctx: Ctx, orgId: string, now: number) {
  const projects = (
    await ctx.db.query("projects").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  ).filter((p) => p.archivedAt === undefined);
  const tasks = await ctx.db.query("projectTasks").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const links = await ctx.db.query("projectLinks").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const names = await ownerNames(ctx, projects);
  const tasksBy = new Map<string, Doc<"projectTasks">[]>();
  for (const t of tasks) tasksBy.set(t.projectId, [...(tasksBy.get(t.projectId) ?? []), t]);
  const linkCount = new Map<string, number>();
  for (const l of links) linkCount.set(l.projectId, (linkCount.get(l.projectId) ?? 0) + 1);
  return projects.map((p) =>
    cardOf(
      p,
      tasksBy.get(p._id) ?? [],
      p.ownerMemberId ? names.get(p.ownerMemberId) ?? null : null,
      linkCount.get(p._id) ?? 0,
      now,
    ),
  );
}

/* ── Reads ───────────────────────────────────────────────── */

/** The board: every live project in this studio, with the numbers a card
 *  needs. The screen groups it by stage. */
export const board = query({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const { orgId } = await scope(ctx, "projects.read");
    const cards = await cardsForOrg(ctx, orgId, nowMs ?? Date.now());
    return {
      stages: PROJECT_STAGES,
      projects: cards.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) || b.updatedAt - a.updatedAt),
    };
  },
});

/** One project with its tasks and links. */
export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { orgId } = await scope(ctx, "projects.read");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) return null;
    const [tasks, links, owner, members] = await Promise.all([
      ctx.db.query("projectTasks").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
      ctx.db.query("projectLinks").withIndex("by_project", (q) => q.eq("projectId", id)).collect(),
      p.ownerMemberId ? ctx.db.get(p.ownerMemberId) : null,
      ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    const names = new Map(members.map((m) => [m._id as string, m.name]));
    return {
      ...p,
      ownerName: owner?.name ?? null,
      tasks: tasks
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((t) => ({ ...t, ownerName: t.ownerMemberId ? names.get(t.ownerMemberId) ?? null : null })),
      links: links.sort((a, b) => a.createdAt - b.createdAt),
    };
  },
});

/** Projects that belong on the Today screen: overdue first, then due soonest,
 *  then whatever moved last. Degrades to "not enabled" instead of throwing,
 *  so the dashboard simply leaves the card out for a person or a studio that
 *  does not have projects. */
export const todayCards = query({
  args: { nowMs: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { nowMs, limit }) => {
    let orgId: string;
    try {
      ({ orgId } = await scope(ctx, "projects.read"));
    } catch {
      return { enabled: false as const, activeCount: 0, overdueCount: 0, projects: [] };
    }
    const now = nowMs ?? Date.now();
    const live = (await cardsForOrg(ctx, orgId, now)).filter((c) => c.stage !== "complete");
    const urgency = (c: (typeof live)[number]) => {
      if (c.overdue || c.overdueTaskCount > 0) return 0;
      if (c.dueDate !== null && c.dueDate - now <= 7 * DAY) return 1;
      return 2;
    };
    live.sort(
      (a, b) =>
        urgency(a) - urgency(b) ||
        (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity) ||
        b.updatedAt - a.updatedAt,
    );
    return {
      enabled: true as const,
      activeCount: live.length,
      overdueCount: live.filter((c) => c.overdue || c.overdueTaskCount > 0).length,
      projects: live.slice(0, Math.max(1, Math.min(limit ?? 4, 12))),
    };
  },
});

/** What a link picker can offer: recent rows of every kind, this studio only. */
export const linkCandidates = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await scope(ctx, "projects.read");
    const [songs, sessions, rooms, members, invoices] = await Promise.all([
      ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(60),
      ctx.db.query("sessions").withIndex("by_org_start", (q) => q.eq("orgId", orgId)).order("desc").take(60),
      ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      // Bills are money: only offered to someone who may read invoices.
      (await resolveViewer(ctx)).capabilities.has("invoices.read")
        ? ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(40)
        : Promise.resolve([] as Doc<"invoices">[]),
    ]);
    return {
      song: songs.map((d) => ({ id: d._id as string, label: d.title })),
      session: sessions.map((d) => ({ id: d._id as string, label: d.title })),
      room: rooms.map((d) => ({ id: d._id as string, label: d.name })),
      engineer: members.map((d) => ({ id: d._id as string, label: d.name })),
      invoice: invoices.map((d) => ({ id: d._id as string, label: `Invoice ${d.number}` })),
    };
  },
});

/** Max: every studio in the viewer's group, one screen. Only a group admin
 *  (an agency viewer holding agency.viewAll) gets in, only on a group whose
 *  plan includes crossStudioProjects, and only for studios that are the
 *  group's own, inside the viewer's staff scope, and that themselves hold
 *  projects. Anything else is simply absent from the answer. */
export const crossStudio = query({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind !== "agency_member" || !viewer.capabilities.has("agency.viewAll")) {
      throw new AccessError("CAPABILITY_DENIED", "The all-studios view is for the group admin.");
    }
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();
    const tier = migrateTierValue(agency?.plan) ?? "core";
    if (!capabilitiesForTier(tier).has("crossStudioProjects")) {
      throw upgradeError("crossStudioProjects", tier);
    }
    const now = nowMs ?? Date.now();
    const orgs = await ctx.db
      .query("orgs")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
    const studios = [];
    for (const org of orgs) {
      if (viewer.scopedSubAccountOrgIds !== "all" && !viewer.scopedSubAccountOrgIds.includes(org.orgId)) continue;
      const gate = await orgGate(ctx, org.orgId);
      if (!capabilitiesForTier(gate.tier).has("projects") || gate.disabled.has("projects")) continue;
      const cards = await cardsForOrg(ctx, org.orgId, now);
      studios.push({
        orgId: org.orgId,
        name: org.name,
        activeCount: cards.filter((c) => c.stage !== "complete").length,
        overdueCount: cards.filter((c) => c.overdue || c.overdueTaskCount > 0).length,
        byStage: Object.fromEntries(
          PROJECT_STAGES.map((s) => [s, cards.filter((c) => c.stage === s).length]),
        ) as Record<ProjectStage, number>,
        projects: cards
          .filter((c) => c.stage !== "complete")
          .sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
          .slice(0, 12),
      });
    }
    studios.sort((a, b) => b.overdueCount - a.overdueCount || b.activeCount - a.activeCount);
    return { stages: PROJECT_STAGES, studios };
  },
});

/* ── Writes ──────────────────────────────────────────────── */

const linkInputV = v.object({ kind: projectLinkKindV, refId: v.string() });

export const create = mutation({
  args: {
    name: v.string(),
    stage: v.optional(projectStageV),
    ownerMemberId: v.optional(v.id("members")),
    dueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    songId: v.optional(v.id("songs")),
    links: v.optional(v.array(linkInputV)),
  },
  handler: async (ctx, args) => {
    const { orgId } = await scope(ctx, "projects.edit");
    await assertMember(ctx, orgId, args.ownerMemberId);
    await assertSong(ctx, orgId, args.songId);
    const now = Date.now();
    const id = await ctx.db.insert("projects", {
      orgId,
      name: cleanTitle(args.name, "A project"),
      stage: args.stage ?? "tracking",
      ownerMemberId: args.ownerMemberId,
      dueDate: args.dueDate,
      notes: args.notes?.slice(0, 4000),
      songId: args.songId,
      createdAt: now,
      updatedAt: now,
      stageChangedAt: now,
    });
    if (args.songId) await insertLink(ctx, orgId, id, "song", args.songId);
    for (const l of args.links ?? []) await insertLink(ctx, orgId, id, l.kind, l.refId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "project.created",
      summary: `Project "${args.name.trim()}" started`,
      entityType: "project",
      entityId: id,
      accent: "gold",
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    ownerMemberId: v.optional(v.union(v.id("members"), v.null())),
    dueDate: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
    songId: v.optional(v.union(v.id("songs"), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    await ownProject(ctx, orgId, id);
    await assertMember(ctx, orgId, patch.ownerMemberId);
    await assertSong(ctx, orgId, patch.songId);
    const next: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.name !== undefined) next.name = cleanTitle(patch.name, "A project");
    if (patch.ownerMemberId !== undefined) next.ownerMemberId = patch.ownerMemberId ?? undefined;
    if (patch.dueDate !== undefined) {
      next.dueDate = patch.dueDate ?? undefined;
      // A moved deadline is a fresh deadline: the overdue reminder may fire again.
      next.lastDueReminderAt = undefined;
    }
    if (patch.notes !== undefined) next.notes = patch.notes?.slice(0, 4000) ?? undefined;
    if (patch.songId !== undefined) next.songId = patch.songId ?? undefined;
    await ctx.db.patch(id, next);
    if (patch.songId) await insertLink(ctx, orgId, id, "song", patch.songId);
  },
});

/** Move a project to any stage. Forward is the normal case; back is how a
 *  client revision sends a mix to editing again. Moving a linked song's stage
 *  with it needs songs.edit, and never pulls a released song back. */
export const setStage = mutation({
  args: { id: v.id("projects"), stage: projectStageV },
  handler: async (ctx, { id, stage }) => {
    const { orgId, viewer } = await scope(ctx, "projects.edit");
    const p = await ownProject(ctx, orgId, id);
    if (p.stage === stage) return { changed: false as const };
    const now = Date.now();
    await ctx.db.patch(id, {
      stage,
      stageChangedAt: now,
      updatedAt: now,
      completedAt: stage === "complete" ? now : undefined,
    });

    let songMoved = false;
    const target = SONG_STAGE_FOR_PROJECT_STAGE[stage];
    if (p.songId && target && viewer.capabilities.has("songs.edit")) {
      const song = await ctx.db.get(p.songId);
      if (song && song.orgId === orgId && song.stage !== target) {
        const here = SONG_STAGE_ORDER.indexOf(song.stage);
        // A released song stays released; everything else follows the project.
        if (song.stage !== "released" && here !== -1) {
          await ctx.db.patch(song._id, { stage: target });
          await ctx.db.insert("activity", {
            orgId,
            kind: "song.stage",
            summary: `"${song.title}" moved to ${target}`,
            entityType: "song",
            entityId: song._id,
            accent: "info",
          });
          songMoved = true;
        }
      }
    }

    await ctx.db.insert("activity", {
      orgId,
      kind: "project.stage",
      summary: `"${p.name}" moved to ${stage}`,
      entityType: "project",
      entityId: id,
      accent: stage === "complete" ? "positive" : "info",
    });
    await notifyTeam(ctx, {
      orgId,
      subject: `${p.name} moved to ${stage}`,
      body: `The project "${p.name}" moved from ${p.stage} to ${stage}.`,
      kind: "project.stage",
      toMemberId: p.ownerMemberId,
    });
    return { changed: true as const, songMoved };
  },
});

export const archive = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    await ownProject(ctx, orgId, id);
    await ctx.db.patch(id, { archivedAt: Date.now(), updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    await ownProject(ctx, orgId, id);
    for (const t of await ctx.db.query("projectTasks").withIndex("by_project", (q) => q.eq("projectId", id)).collect()) {
      await ctx.db.delete(t._id);
    }
    for (const l of await ctx.db.query("projectLinks").withIndex("by_project", (q) => q.eq("projectId", id)).collect()) {
      await ctx.db.delete(l._id);
    }
    await ctx.db.delete(id);
  },
});

/* ── Tasks ───────────────────────────────────────────────── */

export const addTask = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    stage: v.optional(projectStageV),
    ownerMemberId: v.optional(v.id("members")),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await scope(ctx, "projects.edit");
    await ownProject(ctx, orgId, args.projectId);
    await assertMember(ctx, orgId, args.ownerMemberId);
    const existing = await ctx.db
      .query("projectTasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const sortOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1) + 1;
    const id = await ctx.db.insert("projectTasks", {
      orgId,
      projectId: args.projectId,
      title: cleanTitle(args.title, "A task"),
      stage: args.stage,
      ownerMemberId: args.ownerMemberId,
      dueDate: args.dueDate,
      done: false,
      sortOrder,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, { updatedAt: Date.now() });
    return id;
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("projectTasks"),
    title: v.optional(v.string()),
    stage: v.optional(v.union(projectStageV, v.null())),
    ownerMemberId: v.optional(v.union(v.id("members"), v.null())),
    dueDate: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    const task = await ownTask(ctx, orgId, id);
    await assertMember(ctx, orgId, patch.ownerMemberId);
    const next: Record<string, unknown> = {};
    if (patch.title !== undefined) next.title = cleanTitle(patch.title, "A task");
    if (patch.stage !== undefined) next.stage = patch.stage ?? undefined;
    if (patch.ownerMemberId !== undefined) next.ownerMemberId = patch.ownerMemberId ?? undefined;
    if (patch.dueDate !== undefined) next.dueDate = patch.dueDate ?? undefined;
    await ctx.db.patch(id, next);
    await ctx.db.patch(task.projectId, { updatedAt: Date.now() });
  },
});

export const setTaskDone = mutation({
  args: { id: v.id("projectTasks"), done: v.boolean() },
  handler: async (ctx, { id, done }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    const task = await ownTask(ctx, orgId, id);
    await ctx.db.patch(id, { done, completedAt: done ? Date.now() : undefined });
    await ctx.db.patch(task.projectId, { updatedAt: Date.now() });
  },
});

export const removeTask = mutation({
  args: { id: v.id("projectTasks") },
  handler: async (ctx, { id }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    const task = await ownTask(ctx, orgId, id);
    await ctx.db.delete(id);
    await ctx.db.patch(task.projectId, { updatedAt: Date.now() });
  },
});

/* ── Links ───────────────────────────────────────────────── */

export const addLink = mutation({
  args: { projectId: v.id("projects"), kind: projectLinkKindV, refId: v.string() },
  handler: async (ctx, { projectId, kind, refId }) => {
    const { orgId, viewer } = await scope(ctx, "projects.edit");
    await ownProject(ctx, orgId, projectId);
    // A bill carries an amount; linking one is a money action.
    if (kind === "invoice" && !viewer.capabilities.has("invoices.read")) {
      throw new AccessError("CAPABILITY_DENIED", `${viewer.kind} lacks invoices.read`);
    }
    return insertLink(ctx, orgId, projectId, kind, refId);
  },
});

export const removeLink = mutation({
  args: { id: v.id("projectLinks") },
  handler: async (ctx, { id }) => {
    const { orgId } = await scope(ctx, "projects.edit");
    const l = await ctx.db.get(id);
    if (!l || l.orgId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Link not found." });
    await ctx.db.delete(id);
  },
});

/* ── Due and overdue reminders ───────────────────────────── */

/** Daily sweep (convex/crons.ts). For every studio that holds projects, one
 *  note per live project that is due within a day or overdue, or that has
 *  tasks in that state, to the project owner; task owners who are someone
 *  else get their own. A project is reminded at most once every 20 hours. */
export const sendDueReminders = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const now = nowMs ?? Date.now();
    const horizon = now + DUE_SOON_MS;
    let sent = 0;
    const orgs = await ctx.db.query("orgs").collect();
    for (const org of orgs) {
      const gate = await orgGate(ctx, org.orgId);
      if (!capabilitiesForTier(gate.tier).has("projects") || gate.disabled.has("projects")) continue;

      const due = await ctx.db
        .query("projects")
        .withIndex("by_org_due", (q) => q.eq("orgId", org.orgId).gt("dueDate", 0).lte("dueDate", horizon))
        .collect();
      const dueTasks = (
        await ctx.db
          .query("projectTasks")
          .withIndex("by_org_due", (q) => q.eq("orgId", org.orgId).gt("dueDate", 0).lte("dueDate", horizon))
          .collect()
      ).filter((t) => !t.done);

      const projectIds = new Set<Id<"projects">>([
        ...due.map((p) => p._id),
        ...dueTasks.map((t) => t.projectId),
      ]);
      for (const pid of projectIds) {
        const p = await ctx.db.get(pid);
        if (!p || p.orgId !== org.orgId || p.stage === "complete" || p.archivedAt !== undefined) continue;
        if (p.lastDueReminderAt !== undefined && now - p.lastDueReminderAt < 20 * 3_600_000) continue;

        const mine = dueTasks.filter((t) => t.projectId === pid);
        const projectLate = p.dueDate !== undefined && p.dueDate < now;
        const projectSoon = p.dueDate !== undefined && p.dueDate >= now && p.dueDate <= horizon;
        const lines: string[] = [];
        if (projectLate) lines.push(`The project is overdue.`);
        else if (projectSoon) lines.push(`The project is due within a day.`);

        const byOwner = new Map<string, Doc<"projectTasks">[]>();
        for (const t of mine) {
          const key = t.ownerMemberId ?? p.ownerMemberId ?? "";
          byOwner.set(key, [...(byOwner.get(key) ?? []), t]);
        }
        const describe = (ts: Doc<"projectTasks">[]) =>
          ts.map((t) => `- ${t.title} (${t.dueDate! < now ? "overdue" : "due soon"})`).join("\n");

        const ownerKey = p.ownerMemberId ?? "";
        const ownTasks = byOwner.get(ownerKey) ?? [];
        byOwner.delete(ownerKey);
        if (lines.length || ownTasks.length) {
          await notifyTeam(ctx, {
            orgId: org.orgId,
            subject: `${p.name}: ${projectLate || mine.some((t) => t.dueDate! < now) ? "overdue" : "due soon"}`,
            body: [...lines, ownTasks.length ? `Tasks:\n${describe(ownTasks)}` : ""].filter(Boolean).join("\n\n"),
            kind: "project.due",
            toMemberId: p.ownerMemberId,
          });
          sent += 1;
        }
        for (const [memberId, ts] of byOwner) {
          if (!memberId) continue;
          await notifyTeam(ctx, {
            orgId: org.orgId,
            subject: `${p.name}: your tasks`,
            body: `Tasks:\n${describe(ts)}`,
            kind: "project.due",
            toMemberId: memberId as Id<"members">,
          });
          sent += 1;
        }
        await ctx.db.patch(pid, { lastDueReminderAt: now });
      }
    }
    return { sent };
  },
});

/** Exposed for the docs and the iOS client: the vocabulary, in one place. */
export const vocabulary = query({
  args: {},
  handler: async () => ({ stages: PROJECT_STAGES, linkKinds: PROJECT_LINK_KINDS }),
});
