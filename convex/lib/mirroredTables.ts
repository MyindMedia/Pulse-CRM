/* Tables the native clients keep a local copy of.
 *
 * Every entry must be orgId-scoped and carry an `orgId`-first index, because a
 * client only ever pulls its own studio's rows (see `convex/sync.ts`). Ten of the
 * ninety tables are agency- or platform-level (`users`, `agencies`, `appState`,
 * ...) and are deliberately absent: a studio's Mac app has no business holding
 * them.
 *
 * The list grows one wave at a time. Adding a table here is all it takes to put
 * it on the wire - `convex/functions.ts` registers a trigger for each name, and
 * `sync.snapshot` will accept it. */
export const MIRRORED_TABLES = [
  // W1 - core entities.
  "orgs",
  "members",
  "rooms",
  "artists",
  "bookableServices",
  "equipment",
  // W2 - the session spine.
  "sessions",
  "songs",
  "availability",
  "shifts",
  "timeOff",
] as const;

export type MirroredTable = (typeof MIRRORED_TABLES)[number];

const MIRRORED = new Set<string>(MIRRORED_TABLES);

/** Whether a client is allowed to ask for this table by name. */
export function isMirroredTable(name: string): name is MirroredTable {
  return MIRRORED.has(name);
}
