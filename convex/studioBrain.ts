/* ============================================================
   Studio Brain - per-subaccount knowledge graph + history.

   An Obsidian / Graphify-style layer: it derives a connected graph of
   the studio's entities (artists, songs, sessions, rooms, gear, staff,
   invoices, deals) and the relationships between them, plus an
   append-only journal of significant events. The Studio Manager
   (studioManager.ts) reasons over this instead of one-off snapshots.

   ISOLATION IS THE INVARIANT: every read here is `by_org`-indexed and
   the builder only ever touches the orgId it is given. One studio's
   graph can never contain another studio's nodes - there is a two-org
   test asserting exactly that.
   ============================================================ */
import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentOrgWithCapability } from "./lib/tenant";
import { summarizeGraph, neighbors, type GNode, type GEdge } from "./lib/studioGraph";

const DAY = 86_400_000;
const SESSION_WINDOW = 365 * DAY; // graph holds the last year of sessions + all future

type DesiredNode = { kind: string; refId: string; label: string; summary?: string; attrs?: Record<string, unknown> };
type DesiredEdge = { fromRef: string; toRef: string; rel: string; weight: number };

/** Derive the desired node + edge sets for one org from its live data. Pure-ish
 *  (reads only; no writes). Every ref is a document id within THIS org. */
async function deriveGraph(ctx: QueryCtx | MutationCtx, orgId: string): Promise<{ nodes: DesiredNode[]; edges: DesiredEdge[] }> {
  const now = Date.now();
  const windowStart = now - SESSION_WINDOW;

  const [artists, songs, sessions, rooms, equipment, members, invoices, opps] = await Promise.all([
    ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("equipment").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);

  const nodes: DesiredNode[] = [];
  const edges: DesiredEdge[] = [];
  const refs = new Set<string>();
  const addNode = (n: DesiredNode) => {
    if (refs.has(n.refId)) return;
    refs.add(n.refId);
    nodes.push(n);
  };
  // Edges are only kept when BOTH endpoints are real nodes.
  const addEdge = (e: DesiredEdge) => {
    if (refs.has(e.fromRef) && refs.has(e.toRef)) edges.push(e);
  };

  for (const a of artists) {
    addNode({
      kind: "artist", refId: a._id, label: a.name,
      attrs: { status: a.status, lifetimeValueCents: a.lifetimeValueCents, sessionCount: a.sessionCount, reliability: a.reliability },
    });
  }
  for (const r of rooms) addNode({ kind: "room", refId: r._id, label: r.name });
  for (const m of members) addNode({ kind: "staff", refId: m._id, label: m.name, attrs: { role: m.role } });
  for (const s of songs) {
    if (s.stage === "delivered" && (s._creationTime ?? now) < windowStart) continue; // prune old delivered
    addNode({ kind: "song", refId: s._id, label: s.title, attrs: { stage: s.stage } });
  }
  // Only rentable gear gets a node (the bookable assets the manager cares about).
  for (const e of equipment) {
    if (!e.rentable) continue;
    addNode({ kind: "gear", refId: e._id, label: e.name, attrs: { category: e.category, rentalPriceCents: e.rentalPriceCents ?? 0 } });
  }
  // Unpaid invoices only (the ones a manager tracks).
  for (const i of invoices) {
    if (i.status === "paid" || i.status === "void") continue;
    addNode({ kind: "invoice", refId: i._id, label: i.number, attrs: { status: i.status, amountCents: i.amountCents, dueDate: i.dueDate } });
  }
  // Open opportunities.
  for (const o of opps) {
    if (o.stage === "won" || o.stage === "lost") continue;
    addNode({ kind: "deal", refId: o._id, label: o.title, attrs: { stage: o.stage, valueCents: o.valueCents } });
  }
  // Recent + upcoming sessions, excluding cancelled/no-show.
  const liveSessions = sessions.filter(
    (s) => s.startTime >= windowStart && s.status !== "cancelled" && s.status !== "no_show",
  );
  for (const s of liveSessions) {
    addNode({ kind: "session", refId: s._id, label: s.title, attrs: { status: s.status, startTime: s.startTime, rateCents: s.rateCents } });
  }

  // Edges.
  for (const s of liveSessions) {
    addEdge({ fromRef: s.artistId, toRef: s._id, rel: "booked", weight: 1 });
    if (s.roomId) addEdge({ fromRef: s._id, toRef: s.roomId, rel: "in_room", weight: 1 });
    if (s.engineerId) addEdge({ fromRef: s._id, toRef: s.engineerId, rel: "engineered_by", weight: 1 });
    if (s.songId) addEdge({ fromRef: s._id, toRef: s.songId, rel: "for_song", weight: 1 });
    for (const ao of s.addOns ?? []) addEdge({ fromRef: ao.equipmentId, toRef: s._id, rel: "rented_on", weight: 1 });
  }
  for (const s of songs) addEdge({ fromRef: s._id, toRef: s.artistId, rel: "by", weight: 1 });
  for (const i of invoices) addEdge({ fromRef: i._id, toRef: i.artistId, rel: "billed_to", weight: 1 });
  for (const o of opps) addEdge({ fromRef: o._id, toRef: o.artistId, rel: "lead_for", weight: 1 });

  return { nodes, edges };
}

/** Rebuild the graph for one org: idempotent upsert of nodes + edges, pruning
 *  anything no longer derived. orgId is passed in already resolved. */
export const rebuildOrg = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const { nodes, edges } = await deriveGraph(ctx, orgId);

    // Degree per ref for centrality, stored on the node.
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.fromRef, (degree.get(e.fromRef) ?? 0) + e.weight);
      degree.set(e.toRef, (degree.get(e.toRef) ?? 0) + e.weight);
    }

    // ── Nodes: upsert by (org, refId), prune the rest. ──
    const existingNodes = await ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const existingByRef = new Map(existingNodes.map((n) => [n.refId, n] as const));
    const desiredRefs = new Set(nodes.map((n) => n.refId));
    for (const n of nodes) {
      const cur = existingByRef.get(n.refId);
      const fields = { kind: n.kind, label: n.label, summary: n.summary, attrs: n.attrs, degree: degree.get(n.refId) ?? 0, updatedAt: now };
      if (cur) await ctx.db.patch(cur._id, fields);
      else await ctx.db.insert("studioGraphNodes", { orgId, refId: n.refId, ...fields });
    }
    for (const cur of existingNodes) if (!desiredRefs.has(cur.refId)) await ctx.db.delete(cur._id);

    // ── Edges: upsert by (org, key), prune the rest. ──
    const existingEdges = await ctx.db.query("studioGraphEdges").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const existingByKey = new Map(existingEdges.map((e) => [e.key, e] as const));
    const desiredKeys = new Set<string>();
    for (const e of edges) {
      const key = `${e.fromRef}|${e.rel}|${e.toRef}`;
      desiredKeys.add(key);
      const cur = existingByKey.get(key);
      if (cur) await ctx.db.patch(cur._id, { weight: e.weight, updatedAt: now });
      else await ctx.db.insert("studioGraphEdges", { orgId, fromRef: e.fromRef, toRef: e.toRef, rel: e.rel, weight: e.weight, key, updatedAt: now });
    }
    for (const cur of existingEdges) if (!desiredKeys.has(cur.key)) await ctx.db.delete(cur._id);

    // Graph is fresh -> run the Studio Manager evaluation over it.
    await ctx.scheduler.runAfter(0, internal.studioManager.evaluateOrg, { orgId });

    return { nodes: nodes.length, edges: edges.length };
  },
});

/** Append one entry to the studio's history journal. Internal helper used by
 *  the manager + event hooks. Org-scoped. */
export async function appendJournal(
  ctx: MutationCtx,
  orgId: string,
  entry: { kind: string; title: string; body?: string; importance?: "low" | "medium" | "high"; entityRefs?: string[]; at?: number },
): Promise<void> {
  await ctx.db.insert("studioJournal", {
    orgId,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    importance: entry.importance ?? "low",
    entityRefs: entry.entityRefs,
  });
}

/** Load the org's graph as plain GNode/GEdge for the pure algorithms. */
async function loadGraph(ctx: QueryCtx | MutationCtx, orgId: string): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const [nodeRows, edgeRows] = await Promise.all([
    ctx.db.query("studioGraphNodes").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("studioGraphEdges").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);
  return {
    nodes: nodeRows.map((n) => ({ ref: n.refId, kind: n.kind, label: n.label, attrs: n.attrs as Record<string, unknown> | undefined })),
    edges: edgeRows.map((e) => ({ fromRef: e.fromRef, toRef: e.toRef, rel: e.rel, weight: e.weight })),
  };
}

/** Internal: graph summary + recent journal, for the agent / manager context. */
export const brainContextFor = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const { nodes, edges } = await loadGraph(ctx, orgId);
    const summary = summarizeGraph(nodes, edges);
    const journal = await ctx.db
      .query("studioJournal")
      .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(12);
    return { summary, journal: journal.map((j) => ({ at: j.at, kind: j.kind, title: j.title, importance: j.importance })) };
  },
});

/** Public: the studio's knowledge-graph summary (gated like other analytics). */
export const graphSummary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const { nodes, edges } = await loadGraph(ctx, orgId);
    return summarizeGraph(nodes, edges);
  },
});

/** Public: the studio's history timeline. */
export const timeline = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const rows = await ctx.db
      .query("studioJournal")
      .withIndex("by_org_at", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 30);
    return rows.map((j) => ({ at: j.at, kind: j.kind, title: j.title, body: j.body ?? null, importance: j.importance }));
  },
});

/** Public: one entity and its immediate neighbors (the Obsidian "backlinks"
 *  view for a client, room, song, etc.). */
export const entityNeighbors = query({
  args: { refId: v.string() },
  handler: async (ctx, { refId }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const { nodes, edges } = await loadGraph(ctx, orgId);
    const self = nodes.find((n) => n.ref === refId);
    if (!self) return null;
    const labelOf = new Map(nodes.map((n) => [n.ref, n] as const));
    return {
      node: self,
      neighbors: neighbors(refId, edges)
        .map((nb) => ({ ...nb, label: labelOf.get(nb.ref)?.label ?? "?", kind: labelOf.get(nb.ref)?.kind ?? "?" }))
        .sort((a, b) => b.weight - a.weight),
    };
  },
});
