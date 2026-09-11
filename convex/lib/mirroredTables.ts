import { moneySight, redactMoney, PROCESSOR_FIELDS } from "./money";

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
  // W7 - the patch map. Six tables, not seven: `deviceProfiles` is deliberately
  // absent because a GLOBAL profile has no orgId at all, and this mirror pulls
  // by an orgId-first index. Mirroring it would hand every device a profile the
  // device could never find - a silent hole rather than an error. A read-only
  // canvas does not need it: `ports` carries the pin names and belongs to the
  // device, org-scoped like everything else here.
  "patchSpaces",
  "deviceInstances",
  "ports",
  "connections",
  "patchAnnotations",
  "patchGroups",
  // W8 - the checklists. Both are org-scoped and read by every member on the
  // web (`checklists.forSession`, `arrivalPrep.forSessions` gate on nothing but
  // membership), so they carry no capability here either. A session's pre and
  // post checklist and the front desk's arrival, wrap-up and refresh steps
  // are the things an engineer is standing in a room for.
  "sessionChecklists",
  "arrivalPrep",
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
    // The phone draws the owner's toggle, and needs its current position.
    "managersSeeMoney",
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
export const MIRRORED_CAPABILITY: Partial<Record<MirroredTable, string | readonly string[]>> = {
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
  // The studio-wide clock: payroll to whoever holds the books, the rota to
  // whoever runs the schedule. A manager whose owner has hidden money still
  // sees who is on shift; each punch's pay rate is stripped (lib/money.ts).
  timeEntries: ["insights.read", "schedule.manage"],
  reviews: "insights.read",
  // The patch map. `patch.read` is what the web app requires to open a canvas,
  // and everyone from intern up holds it - tracing a signal path is the job.
  patchSpaces: "patch.read",
  deviceInstances: "patch.read",
  ports: "patch.read",
  connections: "patch.read",
  patchAnnotations: "patch.read",
  patchGroups: "patch.read",
};

/** Strip a document to the fields a device may hold. */
export function projectDoc(
  table: string,
  doc: Record<string, unknown>,
  viewer: MirrorViewer,
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
  const shaped = nested ? nested(out) : out;
  // Processor handles leave for everyone. Money leaves for whoever may not see
  // it, and a device copy is exactly where that matters most.
  const processor = PROCESSOR_FIELDS[table];
  let clean = shaped;
  if (processor?.some((field) => field in shaped)) {
    clean = { ...shaped };
    for (const field of processor) delete clean[field];
  }
  return redactMoney(table, clean, moneySight(viewer.capabilities), "placeholder");
}

/** Whether a caller holds a table's gate: one capability, or any of several. */
function holdsGate(
  needed: string | readonly string[] | undefined,
  capabilities: ReadonlySet<string>,
): boolean {
  if (needed === undefined) return true;
  return typeof needed === "string"
    ? capabilities.has(needed)
    : needed.some((cap) => capabilities.has(cap));
}

/* A device's copy is only as right as the permissions it was fetched under.
 *
 * The change-feed cursor carries this tag, and `sync.cursorIsUsable` refuses a
 * cursor whose tag is not the caller's current one. A manager whose owner has
 * just hidden money, anyone promoted or demoted, a studio that changed a table
 * gate: each re-snapshots instead of keeping rows fetched under the old answer.
 * The epoch moves whenever what a projection strips changes, so every device
 * re-fetches once. */
const MIRROR_EPOCH = "m2";

export function mirrorSightTag(viewer: MirrorViewer): string {
  const sight = moneySight(viewer.capabilities);
  const tables = tablesFor(viewer).join(",");
  let hash = 5381;
  for (let i = 0; i < tables.length; i++) hash = ((hash * 33) ^ tables.charCodeAt(i)) >>> 0;
  return `${MIRROR_EPOCH}.${hash.toString(36)}.${sight.money ? "c" : ""}${sight.books ? "b" : ""}`;
}

/* Rows a person may hold about THEMSELVES, whatever their role.
 *
 * `timeEntries` is gated on `insights.read` because the studio-wide view of the
 * clock is payroll, and an engineer does not get payroll. But an engineer's OWN
 * punches are not payroll - they are the answer to "am I clocked in", which is
 * the first thing the phone is taken out for. Without this an engineer's clock
 * card could never turn green: the write landed, and the row that proved it
 * was never sent back. The same holds for a person's own time-off requests and
 * availability, gated on `schedule.manage` for everyone else's.
 *
 * The rule: a table named here is mirrored to every studio member, and a
 * viewer who lacks the capability receives only the rows whose named field is
 * their own member id. `sync.snapshot` and `sync.pullChanges` apply it row by
 * row; a viewer WITH the capability gets the whole table as before. */
export const MIRRORED_OWN_ROWS: Partial<Record<MirroredTable, string>> = {
  timeEntries: "memberId",
  timeOff: "memberId",
  availability: "memberId",
};

/** Who is asking, as far as the mirror cares. */
export type MirrorViewer = {
  capabilities: Set<string>;
  /** The caller's own members row, when they have one. The demo owner and an
   *  agency member acting as a studio do not, and get no own-row mirror. */
  memberId?: string;
};

/** Whether this caller receives this table at all. */
function mayMirror(table: MirroredTable, viewer: MirrorViewer): boolean {
  if (holdsGate(MIRRORED_CAPABILITY[table], viewer.capabilities)) return true;
  return MIRRORED_OWN_ROWS[table] !== undefined && viewer.memberId !== undefined;
}

/** The tables this caller may mirror, given who they are. */
export function tablesFor(viewer: MirrorViewer | Set<string>): MirroredTable[] {
  const v: MirrorViewer = viewer instanceof Set ? { capabilities: viewer } : viewer;
  return MIRRORED_TABLES.filter((table) => mayMirror(table, v));
}

/** Whether one row of a table may be handed to this caller.
 *
 *  A table the caller holds outright passes every row. A table they hold only
 *  for themselves passes the rows carrying their own member id and nothing
 *  else - so the change feed can be filtered without a second query. */
export function rowAllowed(
  table: MirroredTable,
  doc: Record<string, unknown>,
  viewer: MirrorViewer,
): boolean {
  if (holdsGate(MIRRORED_CAPABILITY[table], viewer.capabilities)) return true;
  const field = MIRRORED_OWN_ROWS[table];
  if (!field || !viewer.memberId) return false;
  return doc[field] === viewer.memberId;
}
