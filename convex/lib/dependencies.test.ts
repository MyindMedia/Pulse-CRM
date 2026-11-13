import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* Every package the deployed backend imports must be declared in package.json
   `dependencies`. A package present only because something else pulls it in
   (a transitive install) can vanish or change major version on any lockfile
   refresh, and the backend then fails to bundle or behaves differently. */

const ROOT = join(__dirname, "..", "..");
const CONVEX = join(ROOT, "convex");

/** Test-only code: test files, fixtures and the testing folder. */
function testOnly(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || /\.fixture\.ts$/.test(path) || /[\\/]testing[\\/]/.test(path);
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "_generated" || name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name) && !testOnly(path)) out.push(path);
  }
  return out;
}

/** The package a bare import names: "@scope/name" or "name". */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("node:") || specifier.startsWith("@/")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Bare specifiers of static imports, re-exports and dynamic imports. */
function importsOf(code: string): string[] {
  const out: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};

describe("backend dependencies", () => {
  it("B-05 every package the backend imports is declared in dependencies", () => {
    const missing: string[] = [];
    for (const file of sources(CONVEX)) {
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        const name = packageOf(spec);
        if (name && !pkg.dependencies?.[name]) missing.push(`${name} (${relative(ROOT, file)})`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("B-05 the S3 signer packages are pinned to the versions already in package-lock.json", () => {
    for (const name of ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]) {
      const locked = lock.packages[`node_modules/${name}`]?.version;
      expect(locked, name).toBeTruthy();
      expect(pkg.dependencies?.[name], name).toBe(locked);
    }
  });
});
