import { describe, it, expect } from "vitest";
import { llmsTxt, llmsFullTxt } from "./llms";
import robots from "@/app/robots";
import { PRICING, TIERS, formatUsd } from "@convex/lib/pricing";

describe("llms.txt", () => {
  it("follows the llmstxt.org shape: H1, blockquote summary, link sections", () => {
    const t = llmsTxt();
    expect(t.startsWith("# Pulse OS\n\n> ")).toBe(true);
    expect(t).toContain("## Key pages");
    expect(t).toContain("(https://studiopulse.tech/pricing)");
    expect(t).toContain("https://studiopulse.tech/llms-full.txt");
  });

  it("quotes every plan at the price the config charges", () => {
    for (const body of [llmsTxt(), llmsFullTxt()]) {
      for (const tier of TIERS) {
        expect(body).toContain(`${PRICING[tier].name}: ${formatUsd(PRICING[tier].monthlyCents)} a month`.split(":")[0]);
        expect(body).toContain(formatUsd(PRICING[tier].monthlyCents));
      }
    }
  });

  it("keeps the house rules: no em dashes, no three-letter category acronym", () => {
    for (const body of [llmsTxt(), llmsFullTxt()]) {
      expect(body).not.toMatch(/—/);
      expect(body).not.toMatch(/\bCRM\b/);
    }
  });
});

describe("robots.txt", () => {
  it("gives every named AI crawler the same rules as everyone else", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const base = JSON.stringify({ ...rules[0], userAgent: undefined });
    expect(rules.map((x) => x.userAgent)).toEqual(expect.arrayContaining(["*", "GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]));
    for (const x of rules) expect(JSON.stringify({ ...x, userAgent: undefined })).toBe(base);
    expect(r.sitemap).toBe("https://studiopulse.tech/sitemap.xml");
  });

  it("names Listed Studios and City Pages so an assistant can recommend them", () => {
    const dir = {
      studios: [{ slug: "vault", name: "Vault", city: "Atlanta", region: "GA", blurb: "Big room,\n old console." }],
      cities: [{ slug: "atlanta-ga", city: "Atlanta", region: "GA", count: 2 }],
    };
    for (const body of [llmsTxt(dir), llmsFullTxt(dir)]) {
      expect(body).toContain("## Studios on Pulse");
      expect(body).toContain("- [Recording studios in Atlanta, GA](https://studiopulse.tech/studios/in/atlanta-ga): 2 studios");
      expect(body).toContain("- [Vault](https://studiopulse.tech/studios/vault), Atlanta, GA: Big room, old console.");
    }
    expect(llmsTxt({ studios: [], cities: [] })).not.toContain("## Studios on Pulse");
  });
});
