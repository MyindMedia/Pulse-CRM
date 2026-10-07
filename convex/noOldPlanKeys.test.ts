import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* ============================================================
   No old plan keys remain.

   The Studio / Pro / Label ladder (and the legacy flow, enterprise,
   growth-as-label, agency and agency_plus values) was renamed outright to
   Core / Growth / Max. This walks src/ and convex/ and fails on any plan
   identifier or plan label from the old ladder.

   The studio ENTITY is not a plan and is never matched: studio_id,
   `studio_${slug}`, the "studio" capability (the Rooms page), artistType
   "label", scope "studio" and the word studio in prose all stay.

   Allowed to spell the old values, because they exist to migrate them:
     convex/migrations.ts, convex/migrations.test.ts, convex/migrations.refuse.test.ts, convex/lib/legacyPlans.ts
   ============================================================ */

const ROOTS = ["src", "convex"];
const SKIP_DIRS = new Set(["node_modules", "_generated", ".next"]);
const ALLOWED = new Set([
  "convex/migrations.ts",
  "convex/migrations.test.ts",
  "convex/migrations.refuse.test.ts",
  "convex/lib/legacyPlans.ts",
  "convex/noOldPlanKeys.test.ts",
]);

const OLD = "(studio|pro|label|flow|enterprise|agency|agency_plus|solo)";

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "plan or tier set to an old key", re: new RegExp(`\\b(tier|plan|intendedTier|currentTier|requiredTier)["']?\\s*(:|===|!==|==|=)\\s*["']${OLD}["']`) },
  { name: "PLAN_LIMITS indexed by an old key", re: new RegExp(`PLAN_LIMITS(\\.|\\[["'])${OLD}\\b`) },
  { name: "old tier validator literal", re: /v\.literal\(["'](pro|flow|enterprise|agency_plus|solo)["']\)/ },
  { name: "old Stripe price env var", re: /STRIPE_PRICE_(STUDIO|PRO|LABEL|FLOW|ENTERPRISE|AGENCY)\b/ },
  { name: "old plan label", re: /\bStudio Pro\b|\bStudio Growth\b|\bStudio Starter\b/ },
  { name: "old ladder as a list or union", re: /["']studio["']\s*[,|]\s*["']pro["']|["']pro["']\s*[,|]\s*["']label["']/ },
  { name: "old plan named in copy", re: /\b(Label|Pro) (tier|plan)\b|\bon (Label|Pro)\b|\b(to|on) Studio Pro\b|\bLabel-tier\b|\bPro-tier\b/ },
];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

describe("no old plan keys remain", () => {
  const files = ROOTS.flatMap((r) => walk(r, [])).filter((f) => !ALLOWED.has(f));

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  for (const { name, re } of PATTERNS) {
    it(name, () => {
      const hits: string[] = [];
      for (const f of files) {
        const lines = readFileSync(f, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
        });
      }
      expect(hits).toEqual([]);
    });
  }

  it("the patterns themselves catch the old keys", () => {
    const samples = [
      `tier: "studio"`, `plan: "label"`, `PLAN_LIMITS.pro`, `v.literal("enterprise")`,
      `STRIPE_PRICE_LABEL`, `"Studio Pro"`, `["studio", "pro", "label"]`, `Upgrade to the Label plan`,
    ];
    for (const s of samples) expect(PATTERNS.some((p) => p.re.test(s)), s).toBe(true);
    // ...and leave the studio entity alone.
    for (const s of [`orgId: \`studio_\${slug}\``, `scope: "studio"`, `type: "label"`, `key: "studio"`, `kind === "label"`]) {
      expect(PATTERNS.some((p) => p.re.test(s)), s).toBe(false);
    }
  });
});
