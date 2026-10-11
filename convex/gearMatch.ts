import { v } from "convex/values";
import type { ChoiceQuestion } from "@typesafe-ai/sdk";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { askJev, jevEnabled } from "./lib/jevClient";
import { currentOrgWithCapability } from "./lib/tenant";
import {
  GEAR_CATEGORY_QUESTION,
  IMPORT_ROW_LIMIT,
  buildMatchCandidates,
  gearItemState,
  gearMatchQuestion,
  readCategory,
  readMatch,
  type GearCategory,
  type MatchCandidate,
} from "./lib/jev/gearMatch";

/* ============================================================
   Gear categories and duplicate matching, answered by Jev (TypeSafe
   System One). Questions live in lib/jev/gearMatch.ts.

   Suggestions only. Nothing here writes. The inventory import preview shows
   a suggested category with its confidence and a "Looks like your existing
   X" flag, and the owner confirms, changes or skips each row before
   anything is saved. The patch palette offers an existing item when a
   search finds nothing. No key (TYPESAFE_API_KEY), or Jev down, and every
   answer here is empty: the import and the palette work as they always did.

   Jev sees gear only: a row's name, notes and the sheet's category text,
   plus the names and categories of the studio's own items it might
   duplicate. No prices, values, serials or anything financial.
   ============================================================ */

/** Requests in flight at once; TypeSafe's public endpoint rate-limits above about eight. */
const PARALLEL = 6;

type GearRef = { _id: Id<"equipment">; name: string; category: string };

export type ImportRowSuggestion = {
  /** The row's position in the preview, as sent. */
  row: number;
  category?: { value: GearCategory; confidence: number };
  match?: { equipmentId: Id<"equipment">; name: string; probability: number };
};

export type ImportSuggestions = {
  /** False when Jev is off or never answered; the preview then shows nothing new. */
  available: boolean;
  /** Rows looked at, at most IMPORT_ROW_LIMIT. */
  checked: number;
  suggestions: ImportRowSuggestion[];
};

const refs = (rows: Doc<"equipment">[]): GearRef[] =>
  rows.map((r) => ({ _id: r._id, name: r.name, category: r.category }));

/** The caller's own items, for matching an import against. Same gate as
 *  equipment.importBulk. Names and categories only. */
export const _importContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<GearRef[]> => {
    const orgId = await currentOrgWithCapability(ctx, "equipment.edit");
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return refs(rows);
  },
});

/** What the patch palette can list (no cable stock, nothing retired), behind
 *  the palette's own gate. */
export const _paletteContext = internalQuery({
  args: {},
  handler: async (ctx): Promise<GearRef[]> => {
    const orgId = await currentOrgWithCapability(ctx, "patch.read");
    const rows = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return refs(rows.filter((r) => r.category !== "cable" && r.status !== "retired"));
  },
});

const importRowV = v.object({
  row: v.number(),
  name: v.string(),
  notes: v.optional(v.string()),
  /** The sheet's category text, when Pulse did not recognise it. */
  sheetCategory: v.optional(v.string()),
  /** The sheet left the category blank or wrote something unrecognised. */
  needsCategory: v.boolean(),
});

type Plan = {
  row: number;
  state: ReturnType<typeof gearItemState>;
  questions: Record<string, ChoiceQuestion>;
  candidates: MatchCandidate<Id<"equipment">>[];
};

/**
 * Suggestions for an inventory import preview. Writes nothing.
 *
 * For the first IMPORT_ROW_LIMIT rows: a category for each row without a
 * recognised one, and the existing item a row probably duplicates. One Jev
 * request per row that has something to ask, both questions in it; a row
 * with a known category and no look-alike in the inventory costs nothing.
 */
export const suggestImport = action({
  args: { rows: v.array(importRowV) },
  handler: async (ctx, { rows }): Promise<ImportSuggestions> => {
    // Same gate as the import itself: only someone who may edit the inventory asks.
    const existing: GearRef[] = await ctx.runQuery(internal.gearMatch._importContext, {});
    if (!jevEnabled()) return { available: false, checked: 0, suggestions: [] };
    const work = rows.slice(0, IMPORT_ROW_LIMIT).filter((r) => r.name.trim());

    const plans: Plan[] = [];
    for (const r of work) {
      // The same cap the state applies, before any tokenising.
      const name = r.name.trim().slice(0, 200);
      const candidates = buildMatchCandidates(name, existing);
      const questions: Record<string, ChoiceQuestion> = {};
      if (r.needsCategory) questions.category = GEAR_CATEGORY_QUESTION;
      if (candidates.length > 0) questions.match = gearMatchQuestion(candidates);
      if (Object.keys(questions).length === 0) continue;
      plans.push({
        row: r.row,
        state: gearItemState({ name, notes: r.notes, sheetCategory: r.sheetCategory }),
        questions,
        candidates,
      });
    }

    const suggestions: ImportRowSuggestion[] = [];
    let answered = 0;
    for (let i = 0; i < plans.length; i += PARALLEL) {
      const batch = plans.slice(i, i + PARALLEL);
      const results = await Promise.all(
        batch.map((p) => askJev(p.state, p.questions, { timeoutMs: 8_000 })),
      );
      // Nothing came back from the first batch: Jev is down. Stop asking
      // rather than wait out a timeout per row; the import is unchanged.
      if (i === 0 && results.every((r) => r === null)) break;
      results.forEach((asked, k) => {
        if (!asked) return;
        answered += 1;
        const plan = batch[k];
        const category = readCategory(asked.result.answers.category);
        const match = readMatch(asked.result.answers.match, plan.candidates);
        if (!category && !match) return;
        suggestions.push({
          row: plan.row,
          ...(category ? { category } : {}),
          ...(match ? { match: { equipmentId: match.id, name: match.name, probability: match.probability } } : {}),
        });
      });
    }

    return { available: plans.length === 0 || answered > 0, checked: work.length, suggestions };
  },
});

/**
 * The existing item a typed gear name refers to, for the patch palette's
 * search when it finds nothing ("SM-57" when the item is "Shure SM57").
 * Null when nothing in the studio looks alike, Jev is unsure, or Jev is off.
 */
export const matchName = action({
  args: { name: v.string() },
  handler: async (
    ctx,
    { name },
  ): Promise<{ equipmentId: Id<"equipment">; name: string; probability: number } | null> => {
    const existing: GearRef[] = await ctx.runQuery(internal.gearMatch._paletteContext, {});
    const typed = name.trim().slice(0, 120);
    if (!jevEnabled() || typed.length < 3) return null;
    const candidates = buildMatchCandidates(typed, existing);
    if (candidates.length === 0) return null;
    const asked = await askJev(
      gearItemState({ name: typed }, "search"),
      { match: gearMatchQuestion(candidates) },
      { timeoutMs: 6_000 },
    );
    const match = asked ? readMatch(asked.result.answers.match, candidates) : null;
    return match ? { equipmentId: match.id, name: match.name, probability: match.probability } : null;
  },
});
