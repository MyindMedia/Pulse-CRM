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

/* ── What a device is allowed to hold ──
 *
 * The feed hands back whole documents, and whole documents are how a secret
 * gets out: `orgs` alone carries `googleRefreshToken` (which grants Gmail and
 * Calendar access to the owner's Google account OUTSIDE Pulse), the Stripe
 * account id, the billing subscription ids, the GHL token ref and the pending
 * deletion token. None of that has ever been returned to a browser - `orgs.current`
 * runs everything through the `brandOf` whitelist - and the mirror must not be
 * the first thing to ship it.
 *
 * An allowlist, not a denylist. A denylist rots the first time someone adds a
 * field, and the failure is silent and permanent: it lands in a SQLite file on
 * a laptop that revoking the user's account does not reach.
 *
 * A table absent from this map is sent whole, which is only acceptable because
 * every such table is already returned whole by its own list query. */
export const MIRRORED_FIELDS: Partial<Record<MirroredTable, readonly string[]>> = {
  orgs: [
    "orgId", "name", "slug", "plan", "status", "agencyId",
    "logoStorageId", "accentColor", "tagline", "timezone", "currency",
    "onboardingCompletedAt",
  ],
  // payRateCents and commissionPct are payroll. members.list already returns
  // them to anyone in the org, which is its own bug, but a mirror keeps them
  // on the device after the person leaves.
  members: [
    "orgId", "name", "email", "phone", "role", "skills",
    "avatarColor", "photoId", "clerkImageUrl", "clerkUserId", "bio", "credits",
  ],
};

/* Reads that need more than membership.
 *
 * `timeOff.reason` is free text - surgery, a court date, a bereavement - and the
 * only way to read anyone else's is `availability.pendingTimeOff`, which
 * requires `schedule.manage`. Mirroring the table wholesale would hand every
 * intern the studio's medical and personal absences. The whole studio's weekly
 * availability has no all-members query at all, so mirroring it would grant a
 * capability the product never defined. */
export const MIRRORED_CAPABILITY: Partial<Record<MirroredTable, string>> = {
  timeOff: "schedule.manage",
  availability: "schedule.manage",
};

/** Strip a document to the fields a device may hold. */
export function projectDoc(
  table: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = MIRRORED_FIELDS[table as MirroredTable];
  if (!allowed) return doc;
  // System fields are how the client identifies and orders rows.
  const out: Record<string, unknown> = { _id: doc._id, _creationTime: doc._creationTime };
  for (const field of allowed) {
    if (field in doc) out[field] = doc[field];
  }
  return out;
}

/** The tables this caller may mirror, given the capabilities they hold. */
export function tablesFor(capabilities: Set<string>): MirroredTable[] {
  return MIRRORED_TABLES.filter((table) => {
    const needed = MIRRORED_CAPABILITY[table];
    return !needed || capabilities.has(needed);
  });
}
