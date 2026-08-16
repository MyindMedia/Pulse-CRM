/* ============================================================
   AUTO ARRANGE

   Lay the rack out the way signal actually travels: sources on
   the left, the things they feed to their right, monitors at the
   end. Devices with nothing patched to them sit in a tidy tray
   underneath rather than being scattered through the chain.

   This is a layered (Sugiyama-style) pass, kept deliberately
   small: assign a column by longest path from a source, order
   each column to sit near whatever feeds it, then space them.
   ============================================================ */

export type ArrangeNode = {
  id: string;
  /** Rendered height, so tall patchbays do not overlap short mics. */
  height: number;
};

export type ArrangeEdge = { source: string; target: string };

export type ArrangeResult = Record<string, { x: number; y: number }>;

const COLUMN_GAP = 340;
const ROW_GAP = 36;
const ORPHAN_GAP = 28;

export function autoArrange(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  options?: { columnGap?: number; rowGap?: number },
): ArrangeResult {
  const columnGap = options?.columnGap ?? COLUMN_GAP;
  const rowGap = options?.rowGap ?? ROW_GAP;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }

  // Anything with a cable on it takes part in the chain. Anything with none
  // is parked, so an unpatched spare does not push the signal path around.
  const connected = nodes.filter(
    (n) => outgoing.get(n.id)!.length > 0 || incoming.get(n.id)!.length > 0,
  );
  const orphans = nodes.filter(
    (n) => outgoing.get(n.id)!.length === 0 && incoming.get(n.id)!.length === 0,
  );

  /* ── Column by longest path from a source ─────────────────────
     Longest path rather than shortest, so a device that is both
     two hops and five hops downstream lands to the right of
     everything that feeds it instead of on top of it.
     ──────────────────────────────────────────────────────────── */
  const column = new Map<string, number>();
  const visiting = new Set<string>();

  function depth(id: string): number {
    const known = column.get(id);
    if (known !== undefined) return known;
    // A feedback loop would recurse forever; treat the back edge as depth 0.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const parent of incoming.get(id) ?? []) {
      best = Math.max(best, depth(parent) + 1);
    }
    visiting.delete(id);
    column.set(id, best);
    return best;
  }
  for (const n of connected) depth(n.id);

  const columns = new Map<number, string[]>();
  for (const n of connected) {
    const c = column.get(n.id) ?? 0;
    if (!columns.has(c)) columns.set(c, []);
    columns.get(c)!.push(n.id);
  }

  /* ── Order within each column ─────────────────────────────────
     Sort by the mean position of whatever feeds a device, which
     pulls each box level with its source and takes most of the
     crossings out without a full crossing-minimisation pass.
     ──────────────────────────────────────────────────────────── */
  const order = new Map<string, number>();
  const sortedColumns = [...columns.keys()].sort((a, b) => a - b);

  for (const c of sortedColumns) {
    const ids = columns.get(c)!;
    if (c === 0) {
      ids.sort((a, b) => a.localeCompare(b));
    } else {
      ids.sort((a, b) => {
        const mean = (id: string) => {
          const parents = (incoming.get(id) ?? []).filter((p) => order.has(p));
          if (parents.length === 0) return Number.MAX_SAFE_INTEGER;
          return parents.reduce((sum, p) => sum + order.get(p)!, 0) / parents.length;
        };
        const d = mean(a) - mean(b);
        return d !== 0 ? d : a.localeCompare(b);
      });
    }
    ids.forEach((id, index) => order.set(id, index));
  }

  /* ── Place ────────────────────────────────────────────────── */
  const result: ArrangeResult = {};
  let widestColumnBottom = 0;

  for (const c of sortedColumns) {
    const ids = columns.get(c)!;
    const totalHeight =
      ids.reduce((sum, id) => sum + (byId.get(id)?.height ?? 120), 0) +
      rowGap * Math.max(0, ids.length - 1);

    let y = -totalHeight / 2;
    for (const id of ids) {
      result[id] = { x: c * columnGap, y };
      y += (byId.get(id)?.height ?? 120) + rowGap;
    }
    widestColumnBottom = Math.max(widestColumnBottom, y);
  }

  // Unpatched gear goes in a tray below the chain, in a single row so it
  // reads as a shelf of spares rather than part of the signal path.
  let orphanX = 0;
  const orphanY = widestColumnBottom + 120;
  for (const n of orphans) {
    result[n.id] = { x: orphanX, y: orphanY };
    orphanX += 300 + ORPHAN_GAP;
  }

  return result;
}
