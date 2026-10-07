import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXISTING_GROUPS,
  FEATURE_GROUPS,
  NOT_BUILT_YET,
  PRICING,
  PULSE_APP_CAPABILITIES,
  TIERS,
  formatUsd,
} from "@convex/lib/pricing";

/* /pricing renders from the pricing config, shows nothing that is not built,
   never says CRM, never names a rival, and its JSON-LD offers are the
   config's prices. */

// The page's client parts need Convex and Clerk at runtime. In a render test
// no price id is configured, so every card shows the "Book a demo" fallback.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => async () => ({ checkoutUrl: null }),
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));
vi.mock("@/components/shell/theme-toggle", () => ({ ThemeToggle: () => null }));

const ROOT = join(__dirname, "..", "..", "..");

async function renderPage(): Promise<string> {
  const { default: PricingPage } = await import("./page");
  return renderToStaticMarkup(createElement(PricingPage));
}

/** Visible text: tags and attributes stripped, JSON-LD kept separately. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (m) => JSON.parse(m[1]) as Record<string, unknown>,
  );
}

const RIVALS = [/studio\s*hero/i, /sonido/i, /audiodope/i, /engineears/i, /jammed/i, /studiodock/i, /peerspace/i, /mindbody/i, /square appointments/i, /acuity/i, /vagaro/i, /gusto/i, /homebase/i, /songtrust/i];

describe("/pricing model", () => {
  it("cards carry the config's prices", async () => {
    const { planCards } = await import("./model");
    const cards = planCards();
    expect(cards.map((c) => c.tier)).toEqual([...TIERS]);
    for (const c of cards) {
      expect(c.name).toBe(PRICING[c.tier].name);
      expect(c.monthly.cents).toBe(PRICING[c.tier].monthlyCents);
      expect(c.annual.cents).toBe(PRICING[c.tier].annualCents);
      expect(c.monthly.price).toBe(formatUsd(PRICING[c.tier].monthlyCents));
      expect(c.annual.price).toBe(formatUsd(PRICING[c.tier].annualCents));
    }
    expect(cards.find((c) => c.tier === "max")?.unlimitedStudios).toBe(true);
  });

  it("the comparison table has the 14 groups and only built features", async () => {
    const { comparisonGroups } = await import("./model");
    const groups = comparisonGroups();
    for (const g of EXISTING_GROUPS) expect(groups.map((x) => x.id)).toContain(g.id);
    const builtCount = FEATURE_GROUPS.flatMap((g) => g.items).filter((x) => x.built).length;
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(builtCount);
    const unbuilt = FEATURE_GROUPS.flatMap((g) => g.items).filter((x) => !x.built);
    const production = FEATURE_GROUPS.find((g) => g.isNew);
    if (production && production.items.every((x) => !x.built)) {
      expect(groups.map((g) => g.id)).not.toContain(production.id);
    }
    const shown = groups.flatMap((g) => g.rows.map((r) => r.name));
    for (const x of unbuilt) expect(shown).not.toContain(x.name);
  });

  it("a feature is ticked from its tier upward and never below", async () => {
    const { comparisonGroups } = await import("./model");
    for (const g of comparisonGroups()) {
      for (const r of g.rows) {
        const from = TIERS.indexOf(r.tier);
        TIERS.forEach((t, i) => expect(r.included[t], `${r.name} on ${t}`).toBe(i >= from));
      }
    }
  });

  it("the R2 line is off until Lawrence flips it", async () => {
    const { R2_PER_ORG_LIVE, R2_LINE, faqs } = await import("./model");
    expect(R2_PER_ORG_LIVE).toBe(false);
    expect(faqs().some((f) => f.a.includes(R2_LINE))).toBe(false);
  });

  it("the FAQ covers contract, moving, payments, seats, Max studios and beta", async () => {
    const { faqs } = await import("./model");
    const text = faqs().map((f) => `${f.q} ${f.a}`).join(" ");
    expect(text).toMatch(/no\b.*contract|month to month/i);
    expect(text).toMatch(/move your data for free/i);
    expect(text).toMatch(/running within a day/i);
    expect(text).toMatch(/own Stripe account/i);
    expect(text).toMatch(/no booking commission/i);
    expect(text).toMatch(/no per-seat fees/i);
    expect(text).toMatch(/unlimited studios at one flat price/i);
    expect(text).toMatch(/beta/i);
    expect(text).toContain(formatUsd(PRICING.max.monthlyCents));
  });
});

describe("/pricing page", () => {
  it("renders every plan and price from the config", async () => {
    const text = visibleText(await renderPage());
    for (const t of TIERS) {
      expect(text).toContain(PRICING[t].name);
      expect(text).toContain(formatUsd(PRICING[t].monthlyCents));
      for (const cap of PULSE_APP_CAPABILITIES[t]) expect(text).toContain(cap);
    }
    expect(text).toContain("Run your studio from your phone with the Pulse app for iPhone");
    expect(text).toContain("Book a demo");
  });

  it("falls back to Book a demo when no price id is configured", async () => {
    const html = await renderPage();
    expect(html).not.toMatch(/Start with (Core|Growth|Max)/);
    expect((html.match(/href="\/demo"/g) ?? []).length).toBeGreaterThanOrEqual(TIERS.length + 2);
  });

  it("renders no not-built-yet item and no unbuilt feature", async () => {
    const text = visibleText(await renderPage());
    for (const item of NOT_BUILT_YET) expect(text).not.toContain(item);
    for (const x of FEATURE_GROUPS.flatMap((g) => g.items).filter((x) => !x.built)) {
      expect(text).not.toContain(x.name);
    }
  });

  it("never says CRM, never names a rival, never quotes a sales note", async () => {
    const html = await renderPage();
    expect(html).not.toMatch(/\bcrm\b/i);
    for (const r of RIVALS) expect(html).not.toMatch(r);
    const text = visibleText(html);
    expect(text).not.toMatch(/How to tell on a call/i);
    for (const t of TIERS) expect(text).not.toContain(PRICING[t].salesTell);
    for (const g of FEATURE_GROUPS) expect(text).not.toContain(g.salesNote);
  });

  it("uses no em dashes", async () => {
    expect(visibleText(await renderPage())).not.toMatch(/[—]/);
  });

  it("does not show the R2 line while R2_PER_ORG_LIVE is false", async () => {
    const { R2_LINE } = await import("./model");
    expect(await renderPage()).not.toContain(R2_LINE);
  });

  it("the billing toggle is a pressed-state button group", async () => {
    const html = await renderPage();
    expect(html).toMatch(/aria-pressed="true"[^>]*>Monthly/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Annual/);
  });

  it("JSON-LD offers match the config", async () => {
    const blocks = jsonLdBlocks(await renderPage());
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication") as {
      name: string;
      applicationCategory: string;
      operatingSystem: string;
      offers: { "@type": string; name: string; price: string; priceCurrency: string }[];
    };
    expect(app.name).toBe("Pulse OS");
    expect(app.applicationCategory).toBe("BusinessApplication");
    expect(app.operatingSystem).toBe("Web");
    expect(app.offers).toHaveLength(TIERS.length);
    app.offers.forEach((o, i) => {
      const t = TIERS[i];
      expect(o["@type"]).toBe("Offer");
      expect(o.name).toBe(PRICING[t].name);
      expect(Number(o.price)).toBe(PRICING[t].monthlyUsd);
      expect(o.priceCurrency).toBe("USD");
    });
    const mobile = blocks.find((b) => b["@type"] === "MobileApplication") as { operatingSystem: string; installUrl: string };
    expect(mobile.operatingSystem).toBe("iOS");
    expect(mobile.installUrl).toMatch(/^https:\/\/apps\.apple\.com\//);
    expect(JSON.stringify(blocks)).not.toMatch(/\bcrm\b/i);
  });

  it("has keywords, a canonical and a social card", async () => {
    const { metadata } = await import("./page");
    expect(metadata.keywords).toContain("recording studio management software");
    expect(metadata.alternates?.canonical).toBe("/pricing");
    expect(String(metadata.description)).toContain(formatUsd(PRICING.core.monthlyCents));
    const og = readFileSync(join(__dirname, "opengraph-image.tsx"), "utf8");
    expect(og).toMatch(/export \{ default, alt, size, contentType \}/);
  });

  it("is public in middleware and linked from the nav, footer and homepage", () => {
    const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
    expect(read("src/middleware.ts")).toContain('"/pricing"');
    expect(read("src/components/marketing/landing-nav.tsx")).toContain('href: "/pricing"');
    expect(read("src/components/marketing/footer.tsx")).toContain('href: "/pricing"');
    expect(read("src/components/marketing/hero.tsx")).toContain('href="/pricing"');
    expect(read("src/components/marketing/pricing.tsx")).toContain('href="/pricing"');
    expect(read("src/app/page.tsx")).toContain("SITE_KEYWORDS");
  });
});

/* Old plan names in public and sales copy. The studio ENTITY stays: only
   plan labels are matched. */
const COPY_ROOTS = [
  "src/app/pricing",
  "src/app/mypulse",
  "src/components/marketing",
  "src/app/page.tsx",
  "src/app/mobile",
  "src/app/welcome",
];
const OLD_PLAN_COPY: RegExp[] = [
  /\btier:\s*["'](Studio|Pro|Label)["']/,
  /["'](Studio|Pro|Label)["']\s*[|,]\s*["'](Pro|Label)["']/,
  /\b(Studio|Pro|Label) includes everything\b/,
  /\beverything in (Studio|Pro|Label)\b/,
  /\b(Studio|Pro|Label) (plan|plans|tier)\b/,
  /\b(Studio|Pro) and (Pro|Label) plans\b/,
  /\b(Starter|Premium|Enterprise|Basic) (plan|tier)\b/i,
];

function walk(p: string, out: string[]) {
  const full = join(ROOT, p);
  if (statSync(full).isDirectory()) {
    for (const n of readdirSync(full)) walk(join(p, n), out);
  } else if (/\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p)) {
    out.push(p);
  }
  return out;
}

describe("no old plan names in marketing and sales copy", () => {
  const files = COPY_ROOTS.flatMap((r) => walk(r, []));

  it("scans the marketing tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no names from the old ladder", () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(join(ROOT, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OLD_PLAN_COPY.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("finds no CRM in public copy or outbound email", () => {
    const outbound = [...files, ...walk("convex/lib/emailTemplates", []), "src/app/layout.tsx"];
    const hits = outbound.filter((f) => /\bCRM\b/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("the patterns catch the old names", () => {
    // Built from parts so this file does not trip convex/noOldPlanKeys.test.ts.
    const [S, P, L] = ["Studio", "Pro", "Label"];
    const samples = [
      `tier: "${P}"`,
      `"${S}" | "${P}"`,
      `${P} includes everything in ${S}.`,
      `${S} and ${L} plans include`,
      `the ${L} ${"plan"}`,
      `Enterprise ${"plan"}`,
    ];
    for (const s of samples) {
      expect(OLD_PLAN_COPY.some((re) => re.test(s)), s).toBe(true);
    }
    for (const s of ["your studio", "Studios cannot see each other", "iPhone 17 Pro on a wooden stand"]) {
      expect(OLD_PLAN_COPY.some((re) => re.test(s)), s).toBe(false);
    }
  });
});
