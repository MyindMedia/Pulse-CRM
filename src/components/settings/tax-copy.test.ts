import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* The tax checkbox is saved for records only: nothing reads taxApply when an
   invoice is built. Its label must not say tax is applied (R38). */
describe("tax setting copy", () => {
  const src = readFileSync(join(__dirname, "pricing-panel.tsx"), "utf8");

  it("labels the checkbox as not active yet", () => {
    expect(src).toContain("Plan to charge tax (not active yet)");
    expect(src).not.toMatch(/Apply tax to new invoices/);
  });

  it("the caution line says the setting is for records only", () => {
    const caution = src.slice(src.indexOf("Heads up:"), src.indexOf("</p>", src.indexOf("Heads up:")));
    expect(caution).toMatch(/saved for your records\s+only/);
    expect(caution).not.toMatch(/flipping it on/);
  });
});
