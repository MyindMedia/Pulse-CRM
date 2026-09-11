/** Format integer cents as USD - for activity lines and notification copy. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/* Money, and who may see it.
 *
 * The floor runs the room: engineers, assistants, producers, interns, artist
 * relations. The books belong to owners, managers and accountants. Someone on
 * the floor never sees what a session is worth, what a client has paid, what
 * the gear or the software cost, or what anybody is paid - not on a screen,
 * not in a query answer, and not in the copy a phone keeps. An owner can also
 * take the money away from managers (`orgs.managersSeeMoney`, applied in
 * lib/access.ts), and everything below follows from the capabilities alone.
 *
 * Two capabilities carry it, both already in the policy:
 *   invoices.read  client money: rates, deposits, balances, what a client is
 *                  worth, what the gear, software and licences cost
 *   insights.read  the books: pay rates, payroll, expenses, revenue
 *
 * Hiding a figure in a view is presentation. This file is the boundary. Every
 * read that returns one of these fields passes its rows through `redactMoney`,
 * and so does the device mirror, whose copy outlives the session that fetched
 * it. The field lists are checked against the schema by money.test.ts, because
 * a misspelt field name here is not a type error - it is a leak. */

export type MoneySight = {
  /** Client money: holds `invoices.read`. */
  money: boolean;
  /** The books: holds `insights.read`. */
  books: boolean;
};

export function moneySight(capabilities: ReadonlySet<string>): MoneySight {
  return {
    money: capabilities.has("invoices.read"),
    books: capabilities.has("insights.read"),
  };
}

/** Top-level fields that are client money, per table. */
export const MONEY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  sessions: [
    "rateCents", "depositCents", "depositPaid", "depositForfeited",
    "amountPaidCents", "cancellationFeeCents", "listValueCents", "balanceRemindedAt",
  ],
  artists: ["lifetimeValueCents", "stripeCustomerId", "defaultPaymentMethodId"],
  rooms: ["hourlyRateCents", "depositPct", "paymentMode"],
  bookableServices: ["priceCents", "depositPct"],
  equipment: ["currentValueCents", "purchaseCents", "rentalPriceCents"],
  softwareLicenses: ["costCents"],
  opportunities: ["valueCents"],
  licenses: ["priceCents"],
  syncOpportunities: ["feeCents"],
};

/** Top-level fields that are the books, per table. */
export const BOOKS_FIELDS: Readonly<Record<string, readonly string[]>> = {
  members: ["payRateCents", "payType", "commissionPct"],
  timeEntries: ["rateCentsSnapshot"],
};

/** Payment-processor handles. No person needs these on a device, whatever
 *  their role: a device needs what was paid, never the processor's key to it. */
export const PROCESSOR_FIELDS: Readonly<Record<string, readonly string[]>> = {
  artists: ["stripeCustomerId", "defaultPaymentMethodId"],
};

/* What a device is sent in place of a figure it may not see.
 *
 * A phone decodes each mirrored row into a type generated from the schema, and
 * a required field that is simply missing fails the whole row: an engineer's
 * schedule would come up empty on every build already installed. So the device
 * copy keeps the column and loses the number - a zero, a false - while a query
 * answer for the web drops the field outright. money.test.ts checks that every
 * required money field has one and no optional field does. */
export const MIRROR_PLACEHOLDERS: Readonly<Record<string, Readonly<Record<string, number | boolean>>>> = {
  sessions: { rateCents: 0, depositCents: 0, depositPaid: false },
  artists: { lifetimeValueCents: 0 },
  bookableServices: { priceCents: 0 },
  equipment: { currentValueCents: 0, purchaseCents: 0 },
  softwareLicenses: { costCents: 0 },
  opportunities: { valueCents: 0 },
  licenses: { priceCents: 0 },
};

/** "drop" removes a figure (query answers); "placeholder" keeps a required
 *  column with a zero or false in it (the device mirror). */
export type RedactMode = "drop" | "placeholder";

/** A copy of `doc` without the money this caller may not see. Returns the same
 *  object untouched when there is nothing to strip, so the common owner path
 *  allocates nothing.
 *
 *  Sessions also carry money one level down - an add-on's price - which a
 *  top-level list cannot reach, so those are stripped here by name. */
export function redactMoney<T extends object>(
  table: string,
  doc: T,
  sight: MoneySight,
  mode: RedactMode = "drop",
): T {
  const drop = [
    ...(sight.money ? [] : (MONEY_FIELDS[table] ?? [])),
    ...(sight.books ? [] : (BOOKS_FIELDS[table] ?? [])),
  ];
  const nested = !sight.money && table === "sessions";
  if (drop.length === 0 && !nested) return doc;

  const out: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  const placeholders = mode === "placeholder" ? (MIRROR_PLACEHOLDERS[table] ?? {}) : {};
  for (const field of drop) {
    if (!(field in out)) continue;
    if (field in placeholders) out[field] = placeholders[field];
    else delete out[field];
  }
  if (nested) {
    const blank = mode === "placeholder" ? 0 : undefined;
    if (Array.isArray(out.addOns)) out.addOns = withField(out.addOns, "priceCents", blank);
    if (Array.isArray(out.serviceAddOns)) out.serviceAddOns = withField(out.serviceAddOns, "amountCents", blank);
  }
  return out as T;
}

/** Each item with `field` replaced by `value`, or removed when `value` is undefined. */
function withField(list: unknown[], field: string, value: number | undefined): unknown[] {
  return list.map((item) => {
    if (!item || typeof item !== "object" || !(field in item)) return item;
    const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    if (value === undefined) delete copy[field];
    else copy[field] = value;
    return copy;
  });
}

/** Each row of a list, redacted. */
export function redactEach<T extends object>(
  table: string,
  rows: T[],
  sight: MoneySight,
  mode: RedactMode = "drop",
): T[] {
  if (sight.money && sight.books) return rows;
  return rows.map((row) => redactMoney(table, row, sight, mode));
}
