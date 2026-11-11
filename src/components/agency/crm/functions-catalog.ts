/* Pure helpers for the Functions tab: search, filters, grouping and counts over
   the catalog of Zuops operations. The catalog itself (built from the registry)
   lives in crm-op-form-catalog.ts and is loaded lazily, so this file imports
   nothing from the registry and stays light (eval P-04). */

export type CatalogLevel = "read" | "write" | "admin";
export type CatalogKind = "reaches" | "changes_sending" | "delete";

export type CatalogEntry = {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  area: string;
  summary: string;
  scope: string;
  level: CatalogLevel;
  kind: CatalogKind | null;
};

export const LEVEL_LABEL: Record<CatalogLevel, string> = { read: "Read", write: "Write", admin: "Full access" };

export const KIND_LABEL: Record<CatalogKind, string> = {
  reaches: "Reaches people",
  changes_sending: "Changes automatic sending",
  delete: "Deletes",
};

/** What the confirm dialog says about an operation of this kind. */
export const KIND_SENTENCE: Record<CatalogKind | "starts_intake", string> = {
  reaches: "This reaches real people.",
  changes_sending: "This changes what is sent automatically to real people.",
  delete: "This deletes something.",
  starts_intake: "This starts the new-lead texts for this person.",
};

export const ALL = "all";

export type CatalogFilter = { q: string; area: string; level: CatalogLevel | typeof ALL };

function haystack(e: CatalogEntry): string {
  return `${e.id} ${e.id.replace(/_/g, " ")} ${e.summary} ${e.method} ${e.path} ${e.area}`.toLowerCase();
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
  return searchCatalog(entries, f.q).filter((e) => (f.area === ALL || e.area === f.area) && (f.level === ALL || e.level === f.level));
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

export function catalogStats(entries: readonly CatalogEntry[]): { total: number; areas: number; byLevel: Record<CatalogLevel, number> } {
  const byLevel: Record<CatalogLevel, number> = { read: 0, write: 0, admin: 0 };
  for (const e of entries) byLevel[e.level] += 1;
  return { total: entries.length, areas: Object.keys(areaCounts(entries)).length, byLevel };
}
