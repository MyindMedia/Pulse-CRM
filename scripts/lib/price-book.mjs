/**
 * Price-book binding rules for `scripts/stripe-create-products.mjs`.
 *
 * WHY THIS FILE EXISTS (MYI-252, the cause of MYI-248)
 * ----------------------------------------------------
 * The writer script used to resolve a product with a single mutable tag:
 *
 *     if (p.metadata?.pulse_tier === tierKey || (p.description ?? "").includes(tag)) return p;
 *
 * `pulse_tier` is a key that every generation of the price book wants to own.
 * On 2026-10-07T22:09:18Z `findProduct("growth")` matched `prod_Uf9eq3iDz60Gg8`
 * — the 2026-06-07 $199 tier — printed "reusing product", found no $297/mo
 * price on it, and **created $297/mo + $2,970/yr on that live product**, then
 * pointed Convex prod `STRIPE_PRICE_GROWTH_*` at them. One product id now
 * carries two price-book generations, `slug` is product-scoped so a correct
 * label became impossible, and the `pulse-studio-growth` revenue line was
 * deleted to resolve it. A buyer-facing Checkout Session ran against the
 * mis-parented price within 31 hours.
 *
 * The lesson is broader than the one `revenue-by-product.mjs` design note 6
 * drew ("do not normalise `pulse_tier`'s case"). Case was never the mechanism:
 * **shared ownership of the key was.** `growth` collided at identical case.
 *
 * THE RULES, and why each one is a refusal rather than a fallback
 * --------------------------------------------------------------
 * 1. A product binds only when `pulse_tier` AND `pulse_price_book` both match.
 *    A new book therefore cannot bind to an old generation's product, at any
 *    case, for any key.
 * 2. Two in-book matches is ambiguity, never "take the newest". Stripe lists
 *    newest first, which is what made the old failure silent.
 * 3. A tier key already owned by a DIFFERENT book stops the run and prints the
 *    conflict. It does not quietly fork a second product with the same key.
 *    `--new-generation` is the deliberate opt-in for that, and it still cannot
 *    bind to the old product — it may only create a new one.
 * 4. Another active product already carrying this tier's `slug` stops the run
 *    unconditionally, including under `--new-generation`: `slug` is the
 *    revenue-report grouping key in the storefront repo
 *    (`scripts/revenue-by-product.mjs`), and two live ids on one slug is the
 *    MYI-205 defect being recreated by hand.
 * 5. An active price on the bound product that this tier does not declare means
 *    the product is serving two books. Refuse — do not add a seventh price to
 *    it and do not point Convex at anything on it.
 * 6. There is no description-substring matcher. A product is found by metadata
 *    or not at all. (Measured live 2026-10-09: zero Pulse products carry a
 *    `pulse_tier:` tag in `description`, so nothing depended on it.)
 *
 * Pure functions, no I/O, no SDK, no node builtins — so the suite can prove the
 * refusals fire without a live key (`convex/priceBookBinding.test.ts`).
 */

/**
 * The generation of the Pulse price book this script writes.
 *
 * Bump this in the same commit that changes `TIERS`, and only then. It is
 * stamped onto every product and price the script creates, and it is half of
 * the product lookup key — which is what makes a new book unable to reach an
 * old book's products.
 *
 * 2026-10-07 is the 4th generation: Core $149 / Growth $297 / Max $699.
 * Earlier: 2026-08-20 (STUDIO/PRO/LABEL), 2026-06-07 (studio/pro/growth),
 * 2025-09-17 ($29/mo, still sellable — FOUNDER_ACTION_CHECKLIST PART J).
 */
export const PRICE_BOOK = "2026-10-07";

/** Product metadata key holding the generation. Written by this script only. */
export const BOOK_KEY = "pulse_price_book";

/**
 * The slices of the Stripe objects these rules read. Narrow on purpose: the
 * suite builds them by hand, so anything required here is something a test has
 * to get right, and anything absent here is something the rules must not read.
 *
 * @typedef {{id: string, name?: string|null, description?: string|null,
 *            metadata?: Record<string, string>}} ProductLike
 * @typedef {{id: string, unit_amount?: number|null, currency?: string,
 *            recurring?: {interval: string}|null, active?: boolean}} PriceLike
 * @typedef {{key: string, name: string, slug: string,
 *            prices: Array<{interval: string, cents: number, env?: string}>}} TierLike
 */

const tierOf = (p) => p.metadata?.pulse_tier ?? null;
const bookOf = (p) => p.metadata?.[BOOK_KEY] ?? null;
const slugOf = (p) => p.metadata?.slug ?? null;

const describe = (p) =>
  `${p.id} (${JSON.stringify(p.name ?? "")}, tier=${tierOf(p) ?? "-"}, book=${bookOf(p) ?? "-"}, slug=${slugOf(p) ?? "-"})`;

/**
 * Decide which product a tier may write to, out of the ACTIVE product list.
 *
 * @param {Array<ProductLike>} products active Stripe products
 * @param {TierLike} tier
 * @param {string} book the generation being written (`PRICE_BOOK`)
 * @param {{newGeneration?: boolean}} [opts]
 * @returns {{action: "reuse"|"create"|"blocked", product: ProductLike|null,
 *            conflicts: string[], notes: string[]}}
 */
export function bindProductToTier(products, tier, book, opts = {}) {
  const conflicts = [];
  const notes = [];

  const sameTier = products.filter((p) => tierOf(p) === tier.key);
  const inBook = sameTier.filter((p) => bookOf(p) === book);
  const otherBooks = sameTier.filter((p) => bookOf(p) !== book);

  // Rule 2 — ambiguity is never resolved by order.
  if (inBook.length > 1) {
    conflicts.push(
      `tier "${tier.key}" matches ${inBook.length} products in price book ${book}: ` +
        `${inBook.map(describe).join(" , ")}. Refusing to guess; Stripe lists newest first ` +
        `and that ordering is what made MYI-248 silent.`
    );
    return { action: "blocked", product: null, conflicts, notes };
  }

  const bound = inBook[0] ?? null;

  // Rule 4 — the revenue line's grouping key may not be owned twice.
  const slugSquatters = products.filter((p) => slugOf(p) === tier.slug && p !== bound);
  for (const p of slugSquatters) {
    conflicts.push(
      `slug "${tier.slug}" is already on ${describe(p)}. A slug is product-scoped and is the ` +
        `grouping key in the storefront's revenue-by-product.mjs, so two live ids on one slug ` +
        `splits the revenue line (MYI-205). Choose a different slug or retire that product.`
    );
  }

  if (bound) {
    for (const p of otherBooks) {
      notes.push(`earlier generation left in place: ${describe(p)} — not written to.`);
    }
    if (slugOf(bound) && slugOf(bound) !== tier.slug) {
      notes.push(
        `${bound.id} carries slug="${slugOf(bound)}" while this book declares "${tier.slug}". ` +
          `Leaving the existing slug alone — it is the storefront's label to change, not this script's.`
      );
    }
    return { action: conflicts.length ? "blocked" : "reuse", product: bound, conflicts, notes };
  }

  // Rule 3 — the key is taken by another generation.
  if (otherBooks.length) {
    const owners = otherBooks.map((p) => describe(p)).join(" , ");
    if (!opts.newGeneration) {
      conflicts.push(
        `tier key "${tier.key}" is already owned by another price book: ${owners}. ` +
          `This is the MYI-248 mechanism. Nothing will be written. To start a new generation ` +
          `deliberately, bump PRICE_BOOK and re-run with --new-generation (which may CREATE a ` +
          `new product but can never bind to the one above), or retire that product first.`
      );
      return { action: "blocked", product: null, conflicts, notes };
    }
    notes.push(`--new-generation: creating a fresh product for "${tier.key}"; ${owners} untouched.`);
  }

  return { action: conflicts.length ? "blocked" : "create", product: null, conflicts, notes };
}

/**
 * Active prices on a product that this tier does not declare (rule 5).
 *
 * Measured, not inferred from metadata: the prices created on 2026-10-07 carry
 * no `pulse_price_book` at all, so "which book is this price from?" cannot be
 * read off the object for anything that already exists. "Is this price one of
 * the six this book declares?" can, and it is the question that matters.
 *
 * @param {Array<PriceLike>} prices active Stripe prices for one product
 * @param {TierLike} tier
 * @returns {Array<PriceLike>} the undeclared ones
 */
export function foreignActivePrices(prices, tier) {
  return prices.filter((pr) => {
    if (pr.active === false) return false;
    if (pr.currency !== "usd") return true;
    const interval = pr.recurring?.interval ?? null;
    if (!interval) return true; // a one-time price on a subscription product
    return !tier.prices.some((d) => d.cents === pr.unit_amount && d.interval === interval);
  });
}

/**
 * Human-readable line for a price, for the conflict report.
 * @param {PriceLike} pr
 */
export function priceLabel(pr) {
  const amount = typeof pr.unit_amount === "number" ? `$${pr.unit_amount / 100}` : "?";
  const per = pr.recurring?.interval ? `/${pr.recurring.interval === "year" ? "yr" : "mo"}` : " one-time";
  return `${pr.id} ${amount}${per} ${pr.currency}`;
}
