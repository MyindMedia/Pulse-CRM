/* Tables the native clients keep a local copy of.
 *
 * Every entry must be orgId-scoped and carry an `orgId`-first index, because a
 * client only ever pulls its own studio's rows (see `convex/sync.ts`). Twenty-eight
 * of the ninety-one tables are here. The agency- and platform-level ones (`users`,
 * `agencies`, `appState`, ...) are deliberately absent and always will be: a
 * studio's Mac app has no business holding them.
 *
 * The list grows one wave at a time. Adding a table here is all it takes to put
 * it on the wire - `convex/functions.ts` registers a trigger for each name, and
 * `sync.snapshot` will accept it. What it is NOT enough to do is decide the row
 * is safe to hold: check the table's own read gate and its columns first, and
 * put the answers in `MIRRORED_CAPABILITY` and `MIRRORED_FIELDS` below. */
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
  // W3 - the floor.
  "timeEntries",
  "visitors",
  "packageProducts",
  "packageCredits",
  "softwareLicenses",
  // W4 - money. Every one of these is capability-gated below.
  "payments",
  "invoices",
  "payouts",
  "expenses",
  "feeTemplates",
  // W5 - creative.
  "deliverables",
  "splitSheets",
  "opportunities",
  "releaseCampaigns",
  "licenses",
  "reviews",
  // W6 - client comms.
  "clientMessages",
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
 * every such table is already returned whole by its own list query.
 *
 * Every name here is checked against the schema by `mirroredTables.test.ts`. A
 * misspelt field is not a type error - `projectDoc` skips what a document does
 * not have - so without that test an allowlist can silently drop the column the
 * device needed, which is how an invoice reaches a Mac with no amount on it. */
export const MIRRORED_FIELDS: Partial<Record<MirroredTable, readonly string[]>> = {
  // `logoStorageId` and `currency` were named here from the first wave and are
  // not columns on `orgs` - the storage id is `logoId`, and there is no currency
  // field at all - so a device has never been handed the studio's logo. The
  // schema check below is what found it.
  orgs: [
    "orgId", "name", "slug", "plan", "status", "agencyId",
    "logoId", "accentColor", "tagline", "timezone",
    "onboardingCompletedAt",
  ],
  // payRateCents and commissionPct are payroll. members.list already returns
  // them to anyone in the org, which is its own bug, but a mirror keeps them
  // on the device after the person leaves.
  members: [
    "orgId", "name", "email", "phone", "role", "skills",
    "avatarColor", "photoId", "clerkImageUrl", "clerkUserId", "bio", "credits",
  ],
  // `reference` is the Stripe charge / checkout id. `orgs` already has its
  // `stripeAccountId` stripped for the same reason: a processor handle is the
  // processor's business, and a device only needs what was paid and when.
  payments: [
    "orgId", "sessionId", "kind", "amountCents", "provider", "status",
    "payerName", "paidAt",
  ],
  // A visitor record is somebody who walked in off the street. The email is the
  // dedup key into `artists` and the phone is a lead list; the device needs the
  // visit, not a copy of the studio's walk-in contact book.
  visitors: [
    "orgId", "name", "purpose", "hostName", "artistId", "sessionId",
    "sessionMatchedBy", "termsAcceptedAt", "checkInAt", "checkOutAt", "source",
  ],
  // `licenseKey` is the serial / auth code, marked sensitive in the schema. It
  // is the one field on a mirrored table that is a credential outright: it
  // authorises an install of somebody else's paid software, it survives on the
  // laptop of whoever leaves, and revoking their Pulse account does not reach
  // it. Everything else about a licence is inventory.
  softwareLicenses: [
    "orgId", "name", "vendor", "category", "licenseType", "seats", "costCents",
    "billingInterval", "purchaseDate", "renewalDate", "seatHolder", "status",
    "notes", "createdAt",
  ],
};

/* Fields nested inside an array or object, which `projectDoc` cannot reach.
 *
 * The field allowlist is top-level only, and one table needs more than that:
 * `splitSheets.contributors[]` carries a drawn signature as a PNG data URI, the
 * contributor's email, and their IPI - the number that identifies a writer to a
 * PRO for the rest of their career. A signature image is also the reason a
 * 500-row page would blow its response budget. */
const NESTED_PROJECTORS: Partial<
  Record<MirroredTable, (doc: Record<string, unknown>) => Record<string, unknown>>
> = {
  splitSheets: (doc) => {
    const contributors = doc.contributors;
    if (!Array.isArray(contributors)) return doc;
    return {
      ...doc,
      contributors: contributors.map((c: Record<string, unknown>) => ({
        name: c.name,
        role: c.role,
        masterPct: c.masterPct,
        publishingPct: c.publishingPct,
        pro: c.pro,
        signed: c.signed,
        signedAt: c.signedAt,
        signatureKind: c.signatureKind,
      })),
    };
  },
};

/* Reads that need more than membership.
 *
 * The rule: a table's mirror gate is the capability its own org-wide read
 * requires in the web app. `payments.recent` needs `invoices.read`, so the
 * payments mirror needs `invoices.read`. A mirror must never be the cheaper way
 * into a table, because the device copy outlives the session that fetched it.
 *
 * Two tables have no org-wide read at all, and there the gate comes from the
 * nearest read that does exist. `timeOff.reason` is free text - surgery, a court
 * date, a bereavement - and the only way to read anyone else's is
 * `availability.pendingTimeOff`, which requires `schedule.manage`. Mirroring
 * either wholesale would grant a capability the product never defined. */
export const MIRRORED_CAPABILITY: Partial<Record<MirroredTable, string>> = {
  timeOff: "schedule.manage",
  availability: "schedule.manage",
  // Money. `invoices.read` is what `payments.recent`, `invoices.list`,
  // `packages.list`, `packages.soldCredits` and `feeTemplates.list` require.
  payments: "invoices.read",
  invoices: "invoices.read",
  packageProducts: "invoices.read",
  packageCredits: "invoices.read",
  feeTemplates: "invoices.read",
  // The books. `expenses.list`, `payouts.list`, `payroll.listEntries` and
  // `reviews.listForOrg` all require `insights.read`; engineers see operations,
  // not what the studio banked.
  expenses: "insights.read",
  payouts: "insights.read",
  timeEntries: "insights.read",
  reviews: "insights.read",
};

/** Strip a document to the fields a device may hold. */
export function projectDoc(
  table: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = MIRRORED_FIELDS[table as MirroredTable];
  let out: Record<string, unknown>;
  if (allowed) {
    // System fields are how the client identifies and orders rows.
    out = { _id: doc._id, _creationTime: doc._creationTime };
    for (const field of allowed) {
      if (field in doc) out[field] = doc[field];
    }
  } else {
    out = doc;
  }
  const nested = NESTED_PROJECTORS[table as MirroredTable];
  return nested ? nested(out) : out;
}

/** The tables this caller may mirror, given the capabilities they hold. */
export function tablesFor(capabilities: Set<string>): MirroredTable[] {
  return MIRRORED_TABLES.filter((table) => {
    const needed = MIRRORED_CAPABILITY[table];
    return !needed || capabilities.has(needed);
  });
}
