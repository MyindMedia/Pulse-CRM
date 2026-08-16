import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CONNECTOR_DEFS } from "./lib/connectors";
import { normaliseConnector } from "./lib/specLookup";

/* ============================================================
   The connector vocabulary is declared in three places: the
   mating table, the schema, and the shared arg validators. They
   have to agree, because a value the schema accepts but the
   mating table has never heard of will crash a fit check at the
   worst possible moment - the first time someone patches it.

   Adding a connector means adding it in all three. This is what
   stops that being something you can half-do.
   ============================================================ */

function literalsIn(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${marker}`);
  const block = source.slice(start, source.indexOf(");", start));
  return [...block.matchAll(/v\.literal\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
}

const schemaSrc = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const validatorSrc = readFileSync(new URL("./lib/patchValidators.ts", import.meta.url), "utf8");

describe("the connector vocabulary agrees with itself", () => {
  const mating = Object.keys(CONNECTOR_DEFS).sort();

  it("the schema knows exactly what the mating table knows", () => {
    const schema = literalsIn(schemaSrc, "const connectorType = v.union(").sort();
    expect(schema).toEqual(mating);
  });

  it("the shared validators know exactly the same set", () => {
    const validators = literalsIn(validatorSrc, "export const connectorV = v.union(").sort();
    expect(validators).toEqual(mating);
  });

  // A gendered connector with no gender recorded cannot be checked for the
  // two-males case, which is the one failure the engine exists to catch.
  it("every connector declares whether it has a gender", () => {
    for (const [key, def] of Object.entries(CONNECTOR_DEFS)) {
      expect(typeof def.gendered, `${key}.gendered`).toBe("boolean");
      expect(def.label.length, `${key}.label`).toBeGreaterThan(0);
    }
  });

  // Anything that mates must mate with something that exists.
  it("cross-mates and wildcards point at real connectors", () => {
    for (const [key, def] of Object.entries(CONNECTOR_DEFS)) {
      for (const other of def.crossMates ?? []) {
        expect(mating, `${key} crossMates ${other}`).toContain(other);
      }
      for (const other of def.wildcardFor ?? []) {
        expect(mating, `${key} wildcardFor ${other}`).toContain(other);
      }
    }
  });

  // A connector nobody can spell is a connector a spec sheet will lose.
  it("every non-legacy connector is reachable from written English", () => {
    const legacy = new Set(["xlr", "usb", "other"]);
    for (const key of mating) {
      if (legacy.has(key)) continue;
      expect(normaliseConnector(key), `${key} by its own name`).toBe(key);
    }
  });
});

describe("the connectors added because documentation used them", () => {
  it("reads them out of the words a manual actually prints", () => {
    expect(normaliseConnector("4-pin XLR")).toBe("xlr4");
    expect(normaliseConnector("mini XLR")).toBe("mini_xlr");
    expect(normaliseConnector("TA3 connector")).toBe("mini_xlr");
    expect(normaliseConnector("Euroblock")).toBe("euroblock");
    expect(normaliseConnector("Phoenix terminal block")).toBe("euroblock");
    expect(normaliseConnector("3.5mm TRRS")).toBe("trrs");
    // EtherCON is an RJ45 in a locking shell. Same jack.
    expect(normaliseConnector("etherCON")).toBe("rj45");
  });

  it("still tells a 5-pin XLR from a 4-pin and a mini", () => {
    expect(normaliseConnector("5-pin XLR")).toBe("xlr5");
    expect(normaliseConnector("4-pin XLR")).toBe("xlr4");
    expect(normaliseConnector("mini XLR")).toBe("mini_xlr");
    expect(normaliseConnector("XLR")).toBe("xlr3");
  });
});
