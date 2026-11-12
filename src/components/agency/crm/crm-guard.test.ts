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

/* The CRM components and the CRM route (R3-U5). */
const dirs = [path.resolve(__dirname), path.resolve(__dirname, "../../../app/agency/crm")];
const files = dirs.flatMap((dir) => (readdirSync(dir, { recursive: true }) as string[])
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ name: path.basename(f), dir, src: stripComments(readFileSync(path.join(dir, f), "utf8")) })));

/** Every way found so far to make a confirm flag that is true: the literal, a
 *  truthy shorthand, a computed key, and building it with Object.fromEntries or
 *  Object.assign. */
const TRUTHY = String.raw`(?:true|!0|!!\s*[\w"'\[(]|1\b)`;
const CONFIRM_FLAG = [
  new RegExp(String.raw`\bconfirm\s*:\s*` + TRUTHY),
  new RegExp(String.raw`["'\x60]confirm["'\x60]\s*:\s*` + TRUTHY),
  new RegExp(String.raw`\bconfirm\s*=\s*\{?\s*` + TRUTHY),
  /\[\s*["'\x60]confirm["'\x60]\s*\]\s*(?:=(?!=)|:)/, // obj["confirm"] = x, { ["confirm"]: x } (not the type T["confirm"])
  /\[\s*["'\x60]confirm["'\x60]\s*,/,
  /Object\s*\.\s*(fromEntries|assign|defineProperty)\s*\([^;]*["'\x60]confirm["'\x60]/,
  /Reflect\s*\.\s*set\s*\([^;]*["'\x60]confirm["'\x60]/,
];
const makesConfirm = (src: string) => CONFIRM_FLAG.some((re) => re.test(src));

describe("CRM source guards", () => {
  it("finds the CRM files and the CRM route", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["crm-ui.tsx", "use-zu.ts", "ops.ts", "page.tsx"]));
  });

  it("R3-U5: the confirm-flag detector catches the known evasions and passes ordinary code", () => {
    for (const bad of [
      "run(op, { confirm: true })", "({ confirm : !0 })", "{ confirm: !!grant }", "{ confirm: 1 }", "{ 'confirm': true }",
      'args["confirm"] = x', "{ ['confirm']: ok }", "Object.fromEntries([[\"confirm\", ok]])",
      "Object.assign(args, { [k]: 1 }, 'confirm')", "Object.assign({}, { \"confirm\": v })", "args.confirm = true", "Reflect.set(a, 'confirm', v)",
    ]) expect(makesConfirm(bad), bad).toBe(true);
    for (const ok of [
      "run(op, { path, ...grant })", "const confirm = useConfirm()", "confirm: { title: 'x' }", "needsConfirm: false", "{ confirm: false }",
      'type C = NonNullable<ActionDef["confirm"]>',
    ]) expect(makesConfirm(ok), ok).toBe(false);
  });

  it("a confirm flag is made only in crm-ui.tsx (ConfirmDialog), in the components and the route", () => {
    const offenders = files.filter((f) => f.name !== "crm-ui.tsx" && makesConfirm(f.src));
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
