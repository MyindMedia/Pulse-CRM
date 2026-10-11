import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  GEAR_CATEGORY_CRITERIA,
  GEAR_CATEGORY_QUESTION,
  IMPORT_ROW_LIMIT,
  MATCH_FLAG_MIN_PROBABILITY,
  NONE_OPTION,
  buildMatchCandidates,
  gearItemState,
  gearMatchQuestion,
  readCategory,
  readMatch,
} from "./lib/jev/gearMatch";
import { rowToAsset, toImportItems } from "../src/lib/inventory-import";

/* Jev (TypeSafe System One) for gear: a category for import rows that lack
   one, and a flag on rows that look like gear the studio already owns. These
   hold the promises that matter: Jev only picks from options code built
   (the app's categories; the studio's own look-alike items plus `none`), a
   duplicate is flagged only at 0.8 or above, nothing financial reaches Jev,
   and with no answer from Jev the import is exactly what it always was. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

type Req = { state: { gear: { name: string } }; questions: Record<string, { criteria: Record<string, unknown> }> };

/** A Jev reply for one request: answers only the questions it was asked. */
function reply(
  req: Req,
  answers: { category?: [string, number]; match?: [string, number] },
) {
  const out: Record<string, unknown> = {};
  if (req.questions.category && answers.category) {
    const [choice, confidence] = answers.category;
    out.category = { type: "choice", choice, confidence, probabilities: { [choice]: confidence } };
  }
  if (req.questions.match) {
    const [choice, probability] = answers.match ?? [NONE_OPTION, 0.97];
    out.match = { type: "choice", choice, confidence: probability, probabilities: { [choice]: probability } };
  }
  return { model: "jev-1.13.0", answers: out, usage: { input_tokens: 200, output_tokens: 6 } };
}

const ORG = "org_gear";
const initT = () => convexTest(schema);

async function member(t: ReturnType<typeof initT>, role: "owner" | "engineer", user: string) {
  await t.run(async (ctx) => {
    if (!(await ctx.db.query("orgs").filter((q) => q.eq(q.field("orgId"), ORG)).first())) {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active" });
    }
    await ctx.db.insert("members", { orgId: ORG, name: role, role, clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: role, orgId: ORG });
}

async function stock(t: ReturnType<typeof initT>) {
  const add = (name: string, category: "mic" | "monitor" | "cable", value: number, extra: object = {}) =>
    t.run((ctx) =>
      ctx.db.insert("equipment", {
        orgId: ORG, name, category, status: "available", purchaseCents: value, currentValueCents: value, ...extra,
      }),
    );
  return {
    sm57: await add("Shure SM57", "mic", 9_913),
    u87: await add("Neumann U87 Ai", "mic", 318_700),
    hs8: await add("Yamaha HS8", "monitor", 41_900),
    xlr: await add("XLR Cable 25ft", "cable", 2_400, { serialNumber: "XLR-SECRET-SN" }),
  };
}

const row = (r: number, name: string, extra: { notes?: string; sheetCategory?: string; needsCategory?: boolean } = {}) => ({
  row: r,
  name,
  needsCategory: extra.needsCategory ?? false,
  ...(extra.notes ? { notes: extra.notes } : {}),
  ...(extra.sheetCategory ? { sheetCategory: extra.sheetCategory } : {}),
});

const ITEMS = [
  { _id: "e1", name: "Shure SM57", category: "mic" },
  { _id: "e2", name: "Shure SM7B", category: "mic" },
  { _id: "e3", name: "Neumann U87 Ai", category: "mic" },
  { _id: "e4", name: "Yamaha HS8", category: "monitor" },
  { _id: "e5", name: "XLR Cable 25ft", category: "cable" },
];

describe("gear questions (pure)", () => {
  it("offers exactly the app's own categories, each described, with other last", () => {
    const union = (schema.tables.equipment.validator as unknown as {
      fields: { category: { members: { value: string }[] } };
    }).fields.category.members.map((m) => m.value);
    const options = Object.keys(GEAR_CATEGORY_QUESTION.criteria);
    expect(new Set(options)).toEqual(new Set(union));
    expect(options.at(-1)).toBe("other");
    for (const [key, description] of Object.entries(GEAR_CATEGORY_CRITERIA)) {
      expect(description.length, key).toBeGreaterThan(15);
    }
    expect(GEAR_CATEGORY_QUESTION.type).toBe("choice");
  });

  it("builds match candidates in code: look-alikes best first, unrelated gear left out, none last", () => {
    const candidates = buildMatchCandidates("Shure SM-57", ITEMS);
    expect(candidates[0]).toMatchObject({ option: "Shure SM57", id: "e1" });
    expect(candidates.map((c) => c.name)).not.toContain("Yamaha HS8");
    expect(candidates.map((c) => c.name)).not.toContain("XLR Cable 25ft");

    const question = gearMatchQuestion(candidates);
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria).at(-1)).toBe(NONE_OPTION);
    expect(question.criteria[NONE_OPTION]).toBe("None of these is the same item.");
    for (const c of candidates) expect(question.criteria[c.option]).toContain(c.category);

    // Written differently, still found.
    expect(buildMatchCandidates("SM 57", ITEMS)[0]?.name).toBe("Shure SM57");
    expect(buildMatchCandidates("u87", ITEMS)[0]?.name).toBe("Neumann U87 Ai");
    // Nothing alike: no candidates, so no match question at all.
    expect(buildMatchCandidates("Gibson Les Paul", ITEMS)).toEqual([]);
    // Shared generic words alone do not make a candidate.
    expect(buildMatchCandidates("Boom Mic Stand", ITEMS)).toEqual([]);
  });

  it("keeps the option list sane: one option per name, never `none`, capped", () => {
    const items = [
      { _id: "a", name: "Shure SM57", category: "mic" },
      { _id: "b", name: "shure sm57", category: "mic" },
      { _id: "c", name: "none", category: "other" },
      ...Array.from({ length: 20 }, (_, i) => ({ _id: `s${i}`, name: `Shure SM57 unit ${i}`, category: "mic" })),
    ];
    const candidates = buildMatchCandidates("Shure SM57", items);
    expect(candidates).toHaveLength(8);
    expect(candidates.filter((c) => c.option.toLowerCase() === "shure sm57")).toHaveLength(1);
    expect(candidates.map((c) => c.option)).not.toContain("none");
  });

  it("flags a duplicate at 0.8 and above, never below, never on none", () => {
    const candidates = buildMatchCandidates("Shure SM-57", ITEMS);
    const answer = (choice: string, p: number) => ({ choice, confidence: p, probabilities: { [choice]: p } });
    expect(MATCH_FLAG_MIN_PROBABILITY).toBe(0.8);
    expect(readMatch(answer("Shure SM57", 0.8), candidates)).toEqual({ id: "e1", name: "Shure SM57", probability: 0.8 });
    expect(readMatch(answer("Shure SM57", 0.79), candidates)).toBeNull();
    expect(readMatch(answer(NONE_OPTION, 0.99), candidates)).toBeNull();
    // An option code never offered is ignored, however sure.
    expect(readMatch(answer("Yamaha HS8", 0.99), candidates)).toBeNull();
    expect(readMatch(undefined, candidates)).toBeNull();
  });

  it("suggests a category only when it says something: not other, not a guess", () => {
    const answer = (choice: string, confidence: number) => ({ choice, confidence, probabilities: { [choice]: confidence } });
    expect(readCategory(answer("headphones", 0.9))).toEqual({ value: "headphones", confidence: 0.9 });
    expect(readCategory(answer("other", 0.95))).toBeNull();
    expect(readCategory(answer("mic", 0.1))).toBeNull();
    expect(readCategory(answer("spaceship", 0.99))).toBeNull();
  });

  it("puts gear in the state and nothing else", () => {
    expect(gearItemState({ name: "Shure SM-57", notes: "dented grille", sheetCategory: "Dynamics" })).toEqual({
      context: expect.stringContaining("gear inventory spreadsheet"),
      gear: { name: "Shure SM-57", notes: "dented grille", category_written_in_sheet: "Dynamics" },
    });
  });
});

describe("gearMatch.suggestImport", () => {
  beforeEach(() => {
    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });

  it("asks for a category only on rows missing one, and suggests it with its confidence", async () => {
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    systemOne.mockImplementation(async (req: Req) => reply(req, { category: ["headphones", 0.91] }));

    const res = await owner.action(api.gearMatch.suggestImport, {
      rows: [
        row(0, "Beyerdynamic DT 770", { needsCategory: true }),
        row(1, "Mystery cue box", { needsCategory: true, sheetCategory: "Cue" }),
        row(2, "Neve 1073", { needsCategory: false }),
      ],
    });

    // Row 2 had a recognised category and nothing alike in inventory: never asked.
    expect(systemOne).toHaveBeenCalledTimes(2);
    for (const [req] of systemOne.mock.calls as [Req][]) {
      expect(Object.keys(req.questions)).toEqual(["category"]);
      expect(req.questions.category).toEqual(GEAR_CATEGORY_QUESTION);
    }
    const asked = (systemOne.mock.calls as [Req][]).map(([req]) => req.state.gear);
    expect(asked).toContainEqual({ name: "Mystery cue box", category_written_in_sheet: "Cue" });

    expect(res.available).toBe(true);
    expect(res.suggestions).toEqual([
      { row: 0, category: { value: "headphones", confidence: 0.91 } },
      { row: 1, category: { value: "headphones", confidence: 0.91 } },
    ]);
  });

  it("flags a likely duplicate of the studio's own item at 0.8, not at 0.79", async () => {
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    const ids = await stock(t);
    systemOne.mockImplementation(async (req: Req) =>
      reply(req, { match: ["Shure SM57", req.state.gear.name === "Shure SM-57" ? 0.86 : 0.79] }),
    );

    const res = await owner.action(api.gearMatch.suggestImport, {
      rows: [row(0, "Shure SM-57"), row(1, "SM57 spare")],
    });

    expect(systemOne).toHaveBeenCalledTimes(2);
    for (const [req] of systemOne.mock.calls as [Req][]) {
      expect(Object.keys(req.questions)).toEqual(["match"]);
      const options = Object.keys(req.questions.match.criteria);
      expect(options[0]).toBe("Shure SM57");
      expect(options.at(-1)).toBe(NONE_OPTION);
      expect(options).not.toContain("Yamaha HS8");
    }
    expect(res.suggestions).toEqual([
      { row: 0, match: { equipmentId: ids.sm57, name: "Shure SM57", probability: 0.86 } },
    ]);
    // A flag is a flag: nothing merged, nothing deleted.
    expect(await t.run((ctx) => ctx.db.query("equipment").collect())).toHaveLength(4);
  });

  it("never sends prices, values or serials to Jev, and refuses money in its arguments", async () => {
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    await stock(t);
    systemOne.mockImplementation(async (req: Req) => reply(req, { category: ["cable", 0.9], match: ["XLR Cable 25ft", 0.9] }));

    await owner.action(api.gearMatch.suggestImport, {
      rows: [row(0, "XLR cable 25 ft", { needsCategory: true }), row(1, "Neumann U 87", { needsCategory: true })],
    });

    const sent = JSON.stringify(systemOne.mock.calls);
    for (const leak of ["2400", "318700", "Cents", "XLR-SECRET-SN", "purchase", "value"]) {
      expect(sent).not.toContain(leak);
    }
    await expect(
      owner.action(api.gearMatch.suggestImport, {
        rows: [{ ...row(0, "Neumann U87"), purchaseCents: 320000 } as never],
      }),
    ).rejects.toThrow();
  });

  it("keeps the inventory edit gate: an engineer without it gets nothing asked", async () => {
    const t = initT();
    const engineer = await member(t, "engineer", "u_eng");
    systemOne.mockImplementation(async (req: Req) => reply(req, { category: ["mic", 0.9] }));
    await expect(
      engineer.action(api.gearMatch.suggestImport, { rows: [row(0, "Shure SM57", { needsCategory: true })] }),
    ).rejects.toThrow();
    expect(systemOne).not.toHaveBeenCalled();
  });

  it(`looks at no more than ${IMPORT_ROW_LIMIT} rows per import`, async () => {
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    systemOne.mockImplementation(async (req: Req) => reply(req, { category: ["mic", 0.9] }));
    const rows = Array.from({ length: IMPORT_ROW_LIMIT + 10 }, (_, i) => row(i, `Odd thing ${i}`, { needsCategory: true }));
    const res = await owner.action(api.gearMatch.suggestImport, { rows });
    expect(systemOne).toHaveBeenCalledTimes(IMPORT_ROW_LIMIT);
    expect(res.checked).toBe(IMPORT_ROW_LIMIT);
    expect(Math.max(...res.suggestions.map((s) => s.row))).toBe(IMPORT_ROW_LIMIT - 1);
  });
});

describe("with no answer from Jev, the import is unchanged", () => {
  beforeEach(() => {
    systemOne.mockReset();
  });

  const sheet = [
    { name: "Beyerdynamic DT 770", category: "", purchaseValue: "$159", status: "available" },
    { name: "Shure SM-57", category: "Dynamics", currentValue: "99", room: "Studio A" },
    { name: "Neve 1073", category: "preamp", notes: "rack 2" },
  ];

  async function importAsToday(t: ReturnType<typeof initT>, owner: Awaited<ReturnType<typeof member>>) {
    const assets = sheet.map((r) => rowToAsset(r)!);
    const res = await owner.action(api.gearMatch.suggestImport, {
      rows: assets.map((a, i) => row(i, a.name, { notes: a.notes, sheetCategory: a.sheetCategory, needsCategory: !a.categoryKnown })),
    });
    expect(res).toMatchObject({ available: false, suggestions: [] });

    // No suggestions, so no decisions: the exact payload the panel always sent.
    const items = toImportItems(assets, {});
    expect(items).toEqual(
      assets.map((a) => ({
        name: a.name, category: a.category, purchaseCents: a.purchaseCents, currentValueCents: a.currentValueCents,
        serialNumber: a.serialNumber, condition: a.condition, notes: a.notes, status: a.status,
        purchaseDate: a.purchaseDate, roomName: a.roomName,
      })),
    );
    await owner.mutation(api.equipment.importBulk, { items, skipDuplicateSerials: true });
    const saved = await t.run((ctx) => ctx.db.query("equipment").collect());
    const byName = Object.fromEntries(saved.map((e) => [e.name, e.category]));
    expect(byName).toMatchObject({ "Beyerdynamic DT 770": "other", "Shure SM-57": "other", "Neve 1073": "outboard" });
  }

  it("when this deployment has no TypeSafe key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    await stock(t);
    await importAsToday(t, owner);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("when Jev is down, and it stops asking after the first batch", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    systemOne.mockRejectedValue(new Error("network down"));
    await importAsToday(t, owner);

    systemOne.mockClear();
    const rows = Array.from({ length: 20 }, (_, i) => row(i, `Odd thing ${i}`, { needsCategory: true }));
    const res = await owner.action(api.gearMatch.suggestImport, { rows });
    expect(res).toMatchObject({ available: false, suggestions: [] });
    expect(systemOne.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("gearMatch.matchName (patch palette search)", () => {
  beforeEach(() => {
    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });

  it("offers the existing item for a name the search could not find", async () => {
    const t = initT();
    const engineer = await member(t, "engineer", "u_eng"); // patch.read is enough
    const ids = await stock(t);
    systemOne.mockImplementation(async (req: Req) => reply(req, { match: ["Shure SM57", 0.93] }));
    const match = await engineer.action(api.gearMatch.matchName, { name: "sm-57" });
    expect(match).toEqual({ equipmentId: ids.sm57, name: "Shure SM57", probability: 0.93 });
    const [req] = systemOne.mock.calls[0] as [Req];
    expect(req.state).toMatchObject({ context: expect.stringContaining("patch map"), gear: { name: "sm-57" } });
  });

  it("stays quiet below the threshold, for cable stock, and with no key", async () => {
    const t = initT();
    const owner = await member(t, "owner", "u_owner");
    await stock(t);
    systemOne.mockImplementation(async (req: Req) => reply(req, { match: ["Shure SM57", 0.6] }));
    expect(await owner.action(api.gearMatch.matchName, { name: "SM57" })).toBeNull();
    // Cable stock is not a patch device, so it is never offered.
    systemOne.mockClear();
    expect(await owner.action(api.gearMatch.matchName, { name: "XLR Cable 25ft" })).toBeNull();
    expect(systemOne).not.toHaveBeenCalled();
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await owner.action(api.gearMatch.matchName, { name: "SM57" })).toBeNull();
  });
});
