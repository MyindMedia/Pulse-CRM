/* ============================================================
   Jev (TypeSafe System One) questions for gear: which category an item
   belongs to, and whether a gear name is an item the studio already has.

   Pure: no SDK at runtime, no I/O, so the exact questions, the candidate
   list and the thresholds are unit-testable and every caller sends the same
   objects. convex/gearMatch.ts asks them through askJev.

   Select, never generate. The category options are the app's own category
   list (the equipment.category union in convex/schema.ts). The match options
   are items the studio already owns, picked in code by shared name tokens,
   plus a `none` way out. Jev only ever chooses among what code handed it.

   Gear data only: names, notes and the category text from a sheet. Never
   prices, values or anything financial.

   Docs: https://docs.typesafe.ai/primitives/choice.md
         https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md
   ============================================================ */
import type { ChoiceQuestion } from "@typesafe-ai/sdk";
import type { Doc } from "../../_generated/dataModel";

export type GearCategory = Doc<"equipment">["category"];

/** One option per category in the app's own list, with a line that tells it
 *  apart from its neighbours. `satisfies` keeps this in step with the schema:
 *  a category added there fails the type check here until it is described.
 *  Placements follow the curated gear catalog (convex/lib/gearCatalog.ts):
 *  drum machines and grooveboxes are instruments, control surfaces sit with
 *  monitor controllers. `other` stays last; Jev leans toward early options. */
export const GEAR_CATEGORY_CRITERIA = {
  console: "Mixing console, desk or summing mixer (SSL, Neve, API, Audient, digital desks).",
  mic: "Microphone of any kind: dynamic, condenser, ribbon, tube or USB (Shure SM57, Neumann U87).",
  preamp: "Standalone mic preamp or channel strip, including 500-series preamps (Neve 1073, API 512c, Avalon 737).",
  interface: "Audio interface or converter that connects gear to a computer (Universal Audio Apollo, Focusrite Scarlett, RME).",
  outboard: "Outboard processing that is not a preamp: compressor, EQ, reverb, delay or effects unit (1176, LA-2A, Pultec).",
  monitor: "Studio monitor, speaker or subwoofer (Yamaha NS10, Genelec, Adam, Focal, KRK).",
  monitor_controller: "Monitor controller, speaker switcher, talkback box or DAW control surface (Grace m905, Mackie Big Knob).",
  headphones: "Headphones, in-ear monitors, headphone amp or cue mix system (Sony MDR-7506, Beyerdynamic DT 770).",
  synth: "Synthesizer or keyboard workstation: analog, digital, modular or desktop (Moog, Prophet, Nord, Roland Fantom).",
  midi: "MIDI keyboard or pad controller, clip launcher (Akai MPK, Novation Launchkey, Arturia KeyLab).",
  instrument: "Instrument or amp: guitar, bass, drum kit, piano, guitar or bass amp, drum machine, groovebox or sampler (MPC, TR-8S).",
  computer: "Computer, laptop, display, hard drive, server or other IT hardware.",
  rig: "A complete rig or system tracked as one item, such as a mobile recording rig or a podcast kit.",
  furniture: "Furniture: desk, chair, couch, table, equipment rack or shelving.",
  acoustic: "Acoustic treatment: panel, bass trap, diffuser, gobo or isolation booth.",
  decor: "Decor: art, lighting, rug, plant or sign.",
  cable: "Cable, snake, adapter, stand or small accessory (XLR cable, mic stand, pop filter).",
  other: "Fits none of the categories above.",
} satisfies Record<GearCategory, string>;

export function isGearCategory(value: string): value is GearCategory {
  return Object.prototype.hasOwnProperty.call(GEAR_CATEGORY_CRITERIA, value);
}

/** Which category an item belongs to. Asked only for rows whose sheet left
 *  the category blank or wrote something Pulse does not recognise. */
export const GEAR_CATEGORY_QUESTION = {
  type: "choice",
  instructions:
    "Which inventory category does the recording studio gear in `gear` belong to? Judge by what the item is; a category written in the sheet is only a hint.",
  criteria: GEAR_CATEGORY_CRITERIA,
} satisfies ChoiceQuestion;

/** Below this, a category is a guess, not a suggestion: the row stays as the
 *  import would leave it today. A starting point to tune, not a law. */
export const CATEGORY_MIN_CONFIDENCE = 0.3;

/** A match is flagged ("Looks like your existing X") only at or above this
 *  probability. Flags never merge or skip anything; the owner decides. */
export const MATCH_FLAG_MIN_PROBABILITY = 0.8;

/** Import rows looked at per import (server and preview share it). Past
 *  this, rows import exactly as they always have. */
export const IMPORT_ROW_LIMIT = 50;

/** The way out on every match question. */
export const NONE_OPTION = "none";

/** At most this many existing items are offered as match options. */
export const MAX_MATCH_CANDIDATES = 8;

/** The gear Jev looks at. Every field is optional except the name. */
export type GearItem = {
  name: string;
  brand?: string;
  model?: string;
  notes?: string;
  /** The category text as the sheet wrote it, when it was not recognised. */
  sheetCategory?: string;
};

const clip = (text: string, max: number) => {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The state Jev evaluates: the gear as data, never as instructions. Only
 *  what the questions need, because unrelated detail costs accuracy. */
export function gearItemState(item: GearItem, from: "import" | "search" = "import") {
  const gear: Record<string, string> = { name: clip(item.name, 200) };
  if (item.brand?.trim()) gear.brand = clip(item.brand, 80);
  if (item.model?.trim()) gear.model = clip(item.model, 120);
  if (item.notes?.trim()) gear.notes = clip(item.notes, 300);
  if (item.sheetCategory?.trim()) gear.category_written_in_sheet = clip(item.sheetCategory, 60);
  return {
    context:
      from === "import"
        ? "A row from a recording studio's gear inventory spreadsheet, about to be imported into the studio's inventory."
        : "A gear name typed into the search box of a recording studio's patch map.",
    gear,
  };
}

/* ── Match candidates, built in code ─────────────────────────── */

/** Words that say what kind of thing an item is, not which one. Sharing only
 *  these never makes two items candidates. */
const GENERIC_WORDS = new Set([
  "the", "and", "with", "for", "set", "kit", "pair", "new", "used", "black", "white", "silver",
  "mic", "mics", "microphone", "cable", "cables", "stand", "stands", "amp", "amplifier", "speaker",
  "speakers", "monitor", "monitors", "headphone", "headphones", "studio", "channel", "mkii", "mk2",
]);

const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Name → comparable tokens. Punctuation inside a word is dropped, so
 *  "SM-57" and "SM57" are the same token. */
export function gearTokens(name: string): string[] {
  return fold(name)
    .split(/[\s,;:/\\()[\]{}|+&]+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 2);
}

/** The whole name run together: "Neumann U 87" → "neumannu87". */
const compactName = (name: string) => fold(name).replace(/[^a-z0-9]/g, "");

/** A token that can say which item this is: not generic, and either has a
 *  digit or is three letters or more (brands like AKG, API, SSL). */
function distinctive(token: string): boolean {
  if (GENERIC_WORDS.has(token)) return false;
  return /\d/.test(token) || token.length >= 3;
}

/** Long enough to mean something inside another name: four characters, or
 *  three that mix letters and digits ("u87", "hs8"). */
const containable = (compact: string) =>
  compact.length >= 4 || (compact.length === 3 && /\d/.test(compact) && /[a-z]/.test(compact));

export type MatchCandidate<Id extends string = string> = {
  /** The option name Jev sees: the item's own name, unique in the list. */
  option: string;
  id: Id;
  name: string;
  category: string;
};

/** The studio's items that could be the same gear as `name`, best first:
 *  they share a distinctive token, or one name is inside the other once
 *  both are run together ("SM 57" inside "Shure SM57"). Code builds this
 *  list; Jev only picks from it, or picks `none`. */
export function buildMatchCandidates<Id extends string>(
  name: string,
  items: ReadonlyArray<{ _id: Id; name: string; category: string }>,
  max = MAX_MATCH_CANDIDATES,
): MatchCandidate<Id>[] {
  const myCompact = compactName(name);
  if (!myCompact) return [];
  const myDistinct = new Set(gearTokens(name).filter(distinctive));

  const scored: { item: (typeof items)[number]; score: number }[] = [];
  for (const item of items) {
    const compact = compactName(item.name);
    if (!compact) continue;
    let score = 0;
    for (const token of new Set(gearTokens(item.name))) {
      if (myDistinct.has(token)) score += /\d/.test(token) ? 3 : 1;
    }
    const [short, long] = myCompact.length <= compact.length ? [myCompact, compact] : [compact, myCompact];
    if (short === long) score += 10;
    else if (containable(short) && long.includes(short)) score += 4;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const out: MatchCandidate<Id>[] = [];
  const taken = new Set<string>();
  for (const { item } of scored) {
    if (out.length >= max) break;
    const option = clip(item.name, 120);
    const key = option.toLowerCase();
    // Two rows with one name are one option: either is "your existing X".
    // And an item called "none" cannot borrow the way-out option.
    if (taken.has(key) || key === NONE_OPTION) continue;
    taken.add(key);
    out.push({ option, id: item._id, name: item.name, category: item.category });
  }
  return out;
}

/** Whether a gear name is an item the studio already has. The options are
 *  the candidates code found, plus `none`, which stays last. */
export function gearMatchQuestion(candidates: ReadonlyArray<MatchCandidate>) {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.option] = `An item the studio already owns (category: ${c.category}).`;
  criteria[NONE_OPTION] = "None of these is the same item.";
  return {
    type: "choice",
    instructions:
      "Which item that the studio already owns is the same gear as the item in `gear`: the same make and model, even when written differently (spacing, hyphens, brand left off, as in \"Shure SM-57\" and \"SM57\")? A different model, version or size is not the same item.",
    criteria,
  } satisfies ChoiceQuestion;
}

/* ── Reading the answers ─────────────────────────────────────── */

type ChoiceAnswer = { choice: string; confidence: number; probabilities: Readonly<Record<string, number>> };

/** A category worth suggesting, or null. `other` is what an unrecognised row
 *  already gets, so it is never a suggestion; neither is a low-confidence pick. */
export function readCategory(answer: ChoiceAnswer | undefined): { value: GearCategory; confidence: number } | null {
  if (!answer || !isGearCategory(answer.choice) || answer.choice === "other") return null;
  if (!(answer.confidence >= CATEGORY_MIN_CONFIDENCE)) return null;
  return { value: answer.choice, confidence: answer.confidence };
}

/** The existing item to flag, or null: `none`, an option code did not offer,
 *  or a pick below MATCH_FLAG_MIN_PROBABILITY. */
export function readMatch<Id extends string>(
  answer: ChoiceAnswer | undefined,
  candidates: ReadonlyArray<MatchCandidate<Id>>,
): { id: Id; name: string; probability: number } | null {
  if (!answer || answer.choice === NONE_OPTION) return null;
  const picked = candidates.find((c) => c.option === answer.choice);
  if (!picked) return null;
  const probability = answer.probabilities[answer.choice] ?? 0;
  if (!(probability >= MATCH_FLAG_MIN_PROBABILITY)) return null;
  return { id: picked.id, name: picked.name, probability };
}
