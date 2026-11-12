/* Pure helpers for the Functions tab: search, filters, grouping and counts over
   the catalog of Zuops operations. The catalog itself (built from the registry)
   lives in crm-op-form-catalog.ts and is loaded lazily, so this file imports
   nothing from the registry and stays light (eval P-04). */

export type CatalogLevel = "read" | "write" | "admin";
/** Mirrors ConfirmKind in convex/crm/policy.ts (kept here so this file stays
 *  free of the registry; crm-op-form-catalog.ts type-checks the two agree). */
export type CatalogKind = "reaches" | "changes_sending" | "spends" | "exposes" | "delete";

export type CatalogEntry = {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  area: string;
  summary: string;
  scope: string;
  level: CatalogLevel;
  /** The confirm kind with an empty body. */
  kind: CatalogKind | null;
  /** The kind can change with what is sent (for example create_lead with run_intake). */
  dependsOnBody: boolean;
};

export const LEVEL_LABEL: Record<CatalogLevel, string> = { read: "Read", write: "Write", admin: "Full access" };

export const KIND_LABEL: Record<CatalogKind, string> = {
  reaches: "Reaches people",
  changes_sending: "Changes automatic sending",
  spends: "Uses credits",
  exposes: "Sends data outside the account",
  delete: "Deletes",
};

export const KINDS: readonly CatalogKind[] = ["reaches", "changes_sending", "spends", "exposes", "delete"];

export const ALL = "all";
/** Kind filter value for functions that never ask first. */
export const NO_KIND = "none";

export type CatalogFilter = {
  q: string;
  area: string;
  level: CatalogLevel | typeof ALL;
  kind?: CatalogKind | typeof ALL | typeof NO_KIND;
};

function haystack(e: CatalogEntry): string {
  const kind = e.kind ? KIND_LABEL[e.kind] : "";
  return `${e.id} ${e.id.replace(/_/g, " ")} ${e.summary} ${e.method} ${e.path} ${e.area} ${kind}`.toLowerCase();
}

/** Every word of the query must appear in the id, summary, path or area. */
export function searchCatalog(entries: readonly CatalogEntry[], q: string): CatalogEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const h = haystack(e);
    return words.every((w) => h.includes(w));
  });
}

export function filterCatalog(entries: readonly CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const kind = f.kind ?? ALL;
  return searchCatalog(entries, f.q).filter((e) =>
    (f.area === ALL || e.area === f.area)
    && (f.level === ALL || e.level === f.level)
    && (kind === ALL || (kind === NO_KIND ? e.kind === null && !e.dependsOnBody : e.kind === kind)));
}

/** Grouped by area (A to Z), each group by summary. */
export function groupByArea(entries: readonly CatalogEntry[]): Array<{ area: string; entries: CatalogEntry[] }> {
  const map = new Map<string, CatalogEntry[]>();
  for (const e of entries) map.set(e.area, [...(map.get(e.area) ?? []), e]);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([area, list]) => ({ area, entries: [...list].sort((x, y) => x.summary.localeCompare(y.summary)) }));
}

export function areaCounts(entries: readonly CatalogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.area] = (out[e.area] ?? 0) + 1;
  return out;
}

export function catalogStats(entries: readonly CatalogEntry[]): {
  total: number; areas: number; byLevel: Record<CatalogLevel, number>; byKind: Record<CatalogKind | typeof NO_KIND, number>;
} {
  const byLevel: Record<CatalogLevel, number> = { read: 0, write: 0, admin: 0 };
  const byKind: Record<CatalogKind | typeof NO_KIND, number> = { reaches: 0, changes_sending: 0, spends: 0, exposes: 0, delete: 0, none: 0 };
  for (const e of entries) {
    byLevel[e.level] += 1;
    if (e.kind) byKind[e.kind] += 1;
    else if (!e.dependsOnBody) byKind.none += 1;
  }
  return { total: entries.length, areas: Object.keys(areaCounts(entries)).length, byLevel, byKind };
}
