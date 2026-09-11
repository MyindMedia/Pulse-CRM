/* The mirror list, checked against the two things it can silently disagree with:
 * the schema it names columns from, and the capability policy it names gates from.
 *
 * Neither disagreement is a type error. `projectDoc` skips a field a document
 * does not have, so a misspelt allowlist entry compiles, passes review, and ships
 * an invoice to a Mac with no amount on it. A misspelt capability string compiles
 * too, and locks every role out of a table forever. */
import { describe, it, expect } from "vitest";
import schema from "../schema";
import {
  MIRRORED_TABLES,
  MIRRORED_FIELDS,
  MIRRORED_CAPABILITY,
  projectDoc,
  rowAllowed,
  tablesFor,
} from "./mirroredTables";
import {
  STUDIO_ROLE_CAPABILITIES,
  AGENCY_ROLE_CAPABILITIES,
} from "./accessPolicies";

type TableDef = {
  validator: { fields: Record<string, unknown> };
  indexes: ReadonlyArray<{ indexDescriptor: string; fields: ReadonlyArray<string> }>;
};
const tables = schema.tables as unknown as Record<string, TableDef>;

/** Whoever sees everything, so these checks are about projection, not money. */
const OWNER = { capabilities: new Set<string>(STUDIO_ROLE_CAPABILITIES.owner) };

describe("the mirror list agrees with the schema", () => {
  it.each(MIRRORED_TABLES)("%s exists, is org-scoped, and has an orgId-first index", (name) => {
    const table = tables[name];
    expect(table, `${name} is not a table in schema.ts`).toBeDefined();

    // A client only ever pulls its own studio's rows. A table with no orgId has
    // no tenant boundary to pull it along.
    expect(Object.keys(table.validator.fields)).toContain("orgId");

    // `sync.snapshot` paginates `by_org` by name for every table it is asked for.
    const byOrg = table.indexes.find((i) => i.indexDescriptor === "by_org");
    expect(byOrg, `${name} has no by_org index`).toBeDefined();
    expect(byOrg!.fields[0]).toBe("orgId");
  });

  it("names only fields that exist", () => {
    const phantom: string[] = [];
    for (const [name, allowed] of Object.entries(MIRRORED_FIELDS)) {
      const fields = tables[name].validator.fields;
      for (const field of allowed ?? []) {
        if (!(field in fields)) phantom.push(`${name}.${field}`);
      }
    }
    expect(phantom).toEqual([]);
  });

  it("gates only on capabilities a role can actually hold", () => {
    const real = new Set<string>([
      ...Object.values(STUDIO_ROLE_CAPABILITIES).flat(),
      ...Object.values(AGENCY_ROLE_CAPABILITIES).flat(),
    ]);
    for (const cap of Object.values(MIRRORED_CAPABILITY).flatMap((c) => (typeof c === "string" ? [c] : [...(c ?? [])]))) {
      expect(real.has(cap as string), `${cap} is held by no role`).toBe(true);
    }
  });
});

describe("what projectDoc refuses to hand over", () => {
  it("keeps a software licence key off the device", () => {
    const row = {
      _id: "sl1", _creationTime: 1, orgId: "o", name: "Pro Tools",
      category: "daw", licenseType: "subscription", costCents: 3500,
      billingInterval: "monthly", status: "active", createdAt: 1,
      licenseKey: "PT-XXXX-YYYY-ZZZZ",
    };
    const out = projectDoc("softwareLicenses", row, OWNER);
    expect(out.licenseKey).toBeUndefined();
    // Still the inventory row the app needs.
    expect(out.name).toBe("Pro Tools");
    expect(out.costCents).toBe(3500);
  });

  it("keeps a contributor's signature, email and IPI off the device", () => {
    const out = projectDoc("splitSheets", {
      _id: "ss1", _creationTime: 1, orgId: "o", songId: "s1", status: "sent",
      updatedAt: 1,
      contributors: [
        {
          name: "Ellis", role: "producer", masterPct: 50, publishingPct: 50,
          pro: "BMI", ipi: "00123456789", email: "ellis@example.com",
          signed: true, signedAt: 2, signature: "data:image/png;base64,AAAA",
          signatureKind: "drawn", signedFromUa: "Mozilla/5.0",
        },
      ],
    }, OWNER);
    const c = (out.contributors as Record<string, unknown>[])[0];
    expect(c.signature).toBeUndefined();
    expect(c.email).toBeUndefined();
    expect(c.ipi).toBeUndefined();
    expect(c.signedFromUa).toBeUndefined();
    // The split itself is the point of mirroring it.
    expect(c.masterPct).toBe(50);
    expect(c.signed).toBe(true);
    expect(c.signatureKind).toBe("drawn");
  });

  it("leaves an ungated, unlisted table whole", () => {
    const row = { _id: "r1", _creationTime: 1, orgId: "o", title: "Anything" };
    expect(projectDoc("opportunities", row, OWNER)).toEqual(row);
  });
});

describe("who is told to mirror what", () => {
  const capsOf = (role: keyof typeof STUDIO_ROLE_CAPABILITIES) =>
    new Set<string>(STUDIO_ROLE_CAPABILITIES[role]);

  it("keeps the books away from an engineer", () => {
    const forEngineer = tablesFor(capsOf("engineer"));
    for (const table of ["payments", "invoices", "expenses", "payouts", "timeEntries", "reviews"]) {
      expect(forEngineer).not.toContain(table);
    }
    // What an engineer is on the app for.
    expect(forEngineer).toContain("sessions");
    expect(forEngineer).toContain("deliverables");
  });

  it("gives an owner every table", () => {
    expect(tablesFor(capsOf("owner")).length).toBe(MIRRORED_TABLES.length);
  });

  it("gives an accountant the money but not the roster's private absences", () => {
    const forAccountant = tablesFor(capsOf("accountant"));
    expect(forAccountant).toContain("invoices");
    expect(forAccountant).toContain("expenses");
    expect(forAccountant).not.toContain("timeOff");
  });
});

describe("what a person may hold about themselves", () => {
  const engineer = new Set<string>(STUDIO_ROLE_CAPABILITIES.engineer);

  it("sends an engineer their own clock, and only their own", () => {
    // With a members row the table is on the list; the rows are then
    // filtered to the ones carrying that id.
    const me = { capabilities: engineer, memberId: "m_me" };
    expect(tablesFor(me)).toContain("timeEntries");
    expect(rowAllowed("timeEntries", { memberId: "m_me" }, me)).toBe(true);
    expect(rowAllowed("timeEntries", { memberId: "m_them" }, me)).toBe(false);
    // The books are still nowhere near them.
    expect(tablesFor(me)).not.toContain("payments");
    expect(tablesFor(me)).not.toContain("invoices");
  });

  it("gives a caller with no members row nothing for themselves", () => {
    // The demo owner and an agency member acting as a studio have no row, so
    // an own-row table without the capability is simply not on the list.
    const nobody = { capabilities: engineer };
    expect(tablesFor(nobody)).not.toContain("timeEntries");
    expect(rowAllowed("timeEntries", { memberId: "m_me" }, nobody)).toBe(false);
  });

  it("does not filter a table the caller holds outright", () => {
    const owner = { capabilities: new Set<string>(STUDIO_ROLE_CAPABILITIES.owner), memberId: "m_o" };
    expect(rowAllowed("timeEntries", { memberId: "m_them" }, owner)).toBe(true);
    expect(rowAllowed("sessions", { memberId: "m_them" }, owner)).toBe(true);
  });

  it("mirrors both checklists to every member", () => {
    expect(tablesFor(new Set(STUDIO_ROLE_CAPABILITIES.intern))).toContain("sessionChecklists");
    expect(tablesFor(new Set(STUDIO_ROLE_CAPABILITIES.intern))).toContain("arrivalPrep");
  });
});
