/* ============================================================
   Studio Brain - pure graph algorithms.

   The Studio Manager reasons over a per-subaccount knowledge graph:
   nodes are the studio's entities (artists, songs, sessions, rooms,
   gear, staff, invoices, deals) and edges are the relationships
   between them. These functions are pure - they take plain node/edge
   arrays the caller already loaded for ONE org, so they are fully
   unit-testable and can never cross a tenant boundary.
   ============================================================ */

export type GNode = {
  ref: string;
  kind: string;
  label: string;
  attrs?: Record<string, unknown>;
};

export type GEdge = {
  fromRef: string;
  toRef: string;
  rel: string;
  weight: number;
};

/** Connection count per node ref (undirected: both endpoints credited). */
export function degreeMap(edges: GEdge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    m.set(e.fromRef, (m.get(e.fromRef) ?? 0) + e.weight);
    m.set(e.toRef, (m.get(e.toRef) ?? 0) + e.weight);
  }
  return m;
}

/** Nodes ranked by degree (most central first), optionally filtered by kind. */
export function topByDegree(
  nodes: GNode[],
  degree: Map<string, number>,
  opts: { kind?: string; limit?: number } = {},
): { node: GNode; degree: number }[] {
  return nodes
    .filter((n) => !opts.kind || n.kind === opts.kind)
    .map((n) => ({ node: n, degree: degree.get(n.ref) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label))
    .slice(0, opts.limit ?? nodes.length);
}

/** A node's immediate neighbors with the relationship + direction. */
export function neighbors(
  ref: string,
  edges: GEdge[],
): { ref: string; rel: string; weight: number; dir: "out" | "in" }[] {
  const out: { ref: string; rel: string; weight: number; dir: "out" | "in" }[] = [];
  for (const e of edges) {
    if (e.fromRef === ref) out.push({ ref: e.toRef, rel: e.rel, weight: e.weight, dir: "out" });
    else if (e.toRef === ref) out.push({ ref: e.fromRef, rel: e.rel, weight: e.weight, dir: "in" });
  }
  return out;
}

/** Concentration: the single largest share of a weighted total (e.g. revenue by
 *  client, or load by engineer). High share = single-point dependency risk. */
export function concentrationShare(
  weightByRef: Map<string, number>,
): { topRef: string | null; share: number; total: number } {
  let total = 0;
  let topRef: string | null = null;
  let topVal = 0;
  for (const [ref, val] of weightByRef) {
    total += val;
    if (val > topVal) {
      topVal = val;
      topRef = ref;
    }
  }
  return { topRef, share: total > 0 ? topVal / total : 0, total };
}

/** Nodes of the given kind with no edges at all - dormant/idle entities
 *  (gear never rented, a client with no sessions, a song with no work). */
export function orphans(nodes: GNode[], edges: GEdge[], kind?: string): GNode[] {
  const connected = new Set<string>();
  for (const e of edges) {
    connected.add(e.fromRef);
    connected.add(e.toRef);
  }
  return nodes.filter((n) => (!kind || n.kind === kind) && !connected.has(n.ref));
}

/** Roll a graph up into the headline facts a manager scans: counts by kind,
 *  the most-connected entities, and the obvious dependency concentrations. */
export function summarizeGraph(nodes: GNode[], edges: GEdge[]) {
  const degree = degreeMap(edges);
  const countByKind: Record<string, number> = {};
  for (const n of nodes) countByKind[n.kind] = (countByKind[n.kind] ?? 0) + 1;

  const labelOf = new Map(nodes.map((n) => [n.ref, n.label] as const));

  // Revenue-ish weight by client: sum of edges incident to each artist node.
  const clientWeight = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== "artist") continue;
    clientWeight.set(n.ref, degree.get(n.ref) ?? 0);
  }
  // Engineer load: sum of "engineered_by" edge weights per staff node.
  const engineerWeight = new Map<string, number>();
  for (const e of edges) {
    if (e.rel === "engineered_by") {
      engineerWeight.set(e.toRef, (engineerWeight.get(e.toRef) ?? 0) + e.weight);
    }
  }

  const clientConc = concentrationShare(clientWeight);
  const engineerConc = concentrationShare(engineerWeight);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    countByKind,
    topClients: topByDegree(nodes, degree, { kind: "artist", limit: 5 }).map((t) => ({
      label: t.node.label,
      ref: t.node.ref,
      degree: t.degree,
    })),
    clientConcentration: {
      label: clientConc.topRef ? (labelOf.get(clientConc.topRef) ?? null) : null,
      share: Math.round(clientConc.share * 100),
    },
    engineerConcentration: {
      label: engineerConc.topRef ? (labelOf.get(engineerConc.topRef) ?? null) : null,
      share: Math.round(engineerConc.share * 100),
    },
    idleGear: orphans(nodes, edges, "gear").length,
  };
}
