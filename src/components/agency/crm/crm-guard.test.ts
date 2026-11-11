import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/* Source guards for the CRM UI (eval X-06, P-04):
   - `confirm: true` is created only by ConfirmDialog in crm-ui.tsx, so the server's
     "reaches people / DELETE" gate can only be passed from a confirm click.
   - The 352-operation registry (convex/crm/ops.generated) is imported only by the
     Functions screen and its op form, so it stays out of every other chunk.
   - Nothing from Zuops goes to localStorage or sessionStorage, and no response
     body is logged. */

/** Code only: comments may mention these words when they explain the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

const dir = path.resolve(__dirname);
const files = (readdirSync(dir, { recursive: true }) as string[])
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ name: path.basename(f), src: stripComments(readFileSync(path.join(dir, f), "utf8")) }));

describe("CRM source guards", () => {
  it("finds the CRM files", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["crm-ui.tsx", "use-zu.ts", "ops.ts"]));
  });

  it("confirm: true appears only in crm-ui.tsx", () => {
    const offenders = files.filter((f) => f.name !== "crm-ui.tsx" && /confirm\s*:\s*true|["']confirm["']\s*:\s*true|confirm\s*=\s*\{?\s*true/.test(f.src));
    expect(offenders.map((f) => f.name)).toEqual([]);
    expect(files.find((f) => f.name === "crm-ui.tsx")!.src).toMatch(/confirm:\s*true/);
  });

  it("the operations registry is imported only by the Functions screen and its op form", () => {
    const offenders = files.filter((f) => !/^crm-(functions|op-form)/.test(f.name) && /(from\s*|import\s*\(\s*|require\s*\(\s*)["'][^"']*ops\.generated/.test(f.src));
    expect(offenders.map((f) => f.name)).toEqual([]);
  });

  it("no browser storage and no logging of responses", () => {
    const offenders = files.filter((f) => /localStorage|sessionStorage|indexedDB|console\.(log|info|debug|warn|error)/.test(f.src));
    expect(offenders.map((f) => f.name)).toEqual([]);
  });
});
