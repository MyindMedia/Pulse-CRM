import { describe, expect, it } from "vitest";
import {
  PRICE_BOOK,
  bindProductToTier,
  foreignActivePrices,
} from "../scripts/lib/price-book.mjs";

/**
 * MYI-252 — the cause of MYI-248, asserted rather than documented.
 *
 * `scripts/stripe-create-products.mjs` resolved a product by `pulse_tier`
 * alone, so the 4th-generation price book bound to the 2026-06-07 product that
 * already held the key `growth` and created $297/mo + $2,970/yr on it, live.
 * Every `it` below is a shape that run would have accepted.
 *
 * The real products are the ones measured live on 2026-10-09:
 *   prod_VOqifAV7lbRatf  Pulse OS Core    tier=core   book=2026-10-07
 *   prod_Uf9eq3iDz60Gg8  Pulse OS Growth  tier=growth book=2026-10-07 (created 2026-06-07)
 *   prod_Uf9ecRZuBkeMWZ  Pulse Studio Starter tier=studio book=2026-06-07
 */

const GROWTH = {
  key: "growth",
  name: "Pulse OS Growth",
  slug: "pulse-os-growth",
  prices: [
    { interval: "month", cents: 29700, env: "STRIPE_PRICE_GROWTH_MONTHLY" },
    { interval: "year", cents: 297000, env: "STRIPE_PRICE_GROWTH_ANNUAL" },
  ],
};

const product = (
  id: string,
  name: string,
  metadata: Record<string, string>
) => ({ id, name, metadata, description: null });

const price = (
  id: string,
  unit_amount: number,
  interval: string | null,
  currency = "usd"
) => ({ id, unit_amount, currency, recurring: interval ? { interval } : null, active: true });

describe("bindProductToTier — a new price book cannot reach an old one's products", () => {
  it("reuses the product that carries BOTH this tier key and this price book", () => {
    const r = bindProductToTier(
      [product("prod_Uf9eq3iDz60Gg8", "Pulse OS Growth", {
        pulse_tier: "growth",
        pulse_price_book: PRICE_BOOK,
        slug: "pulse-os-growth",
      })],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("reuse");
    expect(r.product?.id).toBe("prod_Uf9eq3iDz60Gg8");
    expect(r.conflicts).toEqual([]);
  });

  it("REFUSES the exact MYI-248 bind: same tier key, earlier price book", () => {
    const r = bindProductToTier(
      [product("prod_Uf9eq3iDz60Gg8", "Pulse Studio Growth", {
        pulse_tier: "growth",
        pulse_price_book: "2026-06-07",
        slug: "pulse-studio-growth",
      })],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("blocked");
    expect(r.product).toBeNull();
    expect(r.conflicts.join(" ")).toMatch(/already owned by another price book/);
    expect(r.conflicts.join(" ")).toMatch(/prod_Uf9eq3iDz60Gg8/);
  });

  it("under --new-generation it may CREATE, but still never binds to the old product", () => {
    const r = bindProductToTier(
      [product("prod_Uf9eq3iDz60Gg8", "Pulse Studio Growth", {
        pulse_tier: "growth",
        pulse_price_book: "2026-06-07",
        slug: "pulse-studio-growth",
      })],
      GROWTH,
      PRICE_BOOK,
      { newGeneration: true }
    );
    expect(r.action).toBe("create");
    expect(r.product).toBeNull();
  });

  it("refuses to pick a winner when two products match tier AND book", () => {
    const r = bindProductToTier(
      [
        product("prod_new", "Pulse OS Growth", { pulse_tier: "growth", pulse_price_book: PRICE_BOOK }),
        product("prod_old", "Pulse OS Growth", { pulse_tier: "growth", pulse_price_book: PRICE_BOOK }),
      ],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("blocked");
    expect(r.conflicts.join(" ")).toMatch(/matches 2 products/);
  });

  it("ignores a `pulse_tier:growth` tag in the description — metadata or nothing", () => {
    const r = bindProductToTier(
      [{
        id: "prod_desc",
        name: "Pulse Studio Growth",
        metadata: {},
        description: "Growth tier. pulse_tier:growth",
      }],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("create");
    expect(r.product).toBeNull();
    expect(r.conflicts).toEqual([]);
  });

  it("does not case-fold the tier key: `GROWTH` is a different book's product", () => {
    const r = bindProductToTier(
      [product("prod_upper", "Pulse Growth", { pulse_tier: "GROWTH", pulse_price_book: "2026-08-20" })],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("create");
    expect(r.product).toBeNull();
  });

  it("creates cleanly when no product has ever held the key", () => {
    const r = bindProductToTier(
      [product("prod_Uf9ecRZuBkeMWZ", "Pulse Studio Starter", {
        pulse_tier: "studio",
        pulse_price_book: "2026-06-07",
        slug: "pulse-studio-starter",
      })],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("create");
    expect(r.conflicts).toEqual([]);
  });

  it("blocks when another live product already owns this tier's slug, even with --new-generation", () => {
    const squatter = [product("prod_squat", "Pulse OS Growth", {
      pulse_tier: "legacy_growth",
      pulse_price_book: "2026-08-20",
      slug: "pulse-os-growth",
    })];
    for (const opts of [{}, { newGeneration: true }]) {
      const r = bindProductToTier(squatter, GROWTH, PRICE_BOOK, opts);
      expect(r.action).toBe("blocked");
      expect(r.conflicts.join(" ")).toMatch(/slug "pulse-os-growth" is already on/);
    }
  });

  it("notes, but does not rewrite, a disagreeing slug on the bound product", () => {
    const r = bindProductToTier(
      [product("prod_Uf9eq3iDz60Gg8", "Pulse OS Growth", {
        pulse_tier: "growth",
        pulse_price_book: PRICE_BOOK,
        slug: "pulse-studio-growth",
      })],
      GROWTH,
      PRICE_BOOK
    );
    expect(r.action).toBe("reuse");
    expect(r.notes.join(" ")).toMatch(/Leaving the existing slug alone/);
  });
});

describe("foreignActivePrices — one product id may not serve two books", () => {
  it("passes the two prices this book declares", () => {
    expect(
      foreignActivePrices(
        [price("price_mo", 29700, "month"), price("price_yr", 297000, "year")],
        GROWTH
      )
    ).toEqual([]);
  });

  it("flags the retired $199/mo that sat on prod_Uf9eq3iDz60Gg8 before MYI-248", () => {
    const foreign = foreignActivePrices(
      [price("price_199", 19900, "month"), price("price_mo", 29700, "month")],
      GROWTH
    );
    expect(foreign.map((p) => p.id)).toEqual(["price_199"]);
  });

  it("flags a one-time price and a non-USD price on a subscription product", () => {
    const foreign = foreignActivePrices(
      [price("price_once", 29700, null), price("price_eur", 29700, "month", "eur")],
      GROWTH
    );
    expect(foreign.map((p) => p.id)).toEqual(["price_once", "price_eur"]);
  });

  it("ignores inactive prices — a retired generation is allowed to exist", () => {
    const inactive = { ...price("price_199", 19900, "month"), active: false };
    expect(foreignActivePrices([inactive, price("price_mo", 29700, "month")], GROWTH)).toEqual([]);
  });
});
