/* Pipeline module - shared constants, types and small helpers. */

export const KANBAN_STAGES = [
  "inquiry",
  "qualified",
  "proposal",
  "booked",
  "in_progress",
  "delivered",
  "won",
] as const;

export type KanbanStage = (typeof KANBAN_STAGES)[number];
export type OppStage = KanbanStage | "lost";

/* ============================================================
   Two colour systems on one board, kept deliberately apart.

   STAGE  = how far along a deal is. A single ramp from cold grey
            through gold to green, so the board reads as movement
            without anyone having to learn it.
   SERVICE = what kind of work it is. Categorical hues, which carry
            no ranking and no judgement.

   The rule that makes them coexist: SERVICE never borrows a
   semantic colour. Green, amber, red and sky already mean won,
   going stale, lost and informational elsewhere in the app - and
   amber in particular appears on the SAME card as the stale
   warning. A mixing deal tinted amber was telling the eye
   "something is wrong here" every time, which is why the board
   felt noisy.
   ============================================================ */

/** Stage ramp: cold to committed to done. Distinct step per stage, so two
 *  neighbouring columns never render the same dot. */
export const STAGE_TINT: Record<string, string> = {
  inquiry: "#6C6C76",      // cold, unqualified
  qualified: "#8A8397",    // warming
  proposal: "#A88C6B",     // interest, edging toward gold
  booked: "#C98A00",       // money committed
  in_progress: "#FDB913",  // in the room, full brand gold
  delivered: "#3DDC91",    // done
  won: "#2FB97A",          // paid, the deepest green
  lost: "#6C6C76",         // out, same cold grey it started as
};

export function stageTint(stage: string): string {
  return STAGE_TINT[stage] ?? "var(--color-ash-dim)";
}

/** Service-type colour hint - drives the left rail tint on each deal card.
 *  Categorical, and deliberately clear of every semantic hue. */
export const SERVICE_TINT: Record<string, string> = {
  recording: "#8B8CF7",    // indigo
  mixing: "#C77DF0",       // orchid
  mastering: "#EC7CB8",    // magenta
  production: "#56C7D6",   // cyan
  consultation: "#8892A6", // slate, the quiet one on purpose
  rehearsal: "#A8C64F",    // lime
  writing: "#F08BA0",      // rose
};

export const SERVICE_LABEL: Record<string, string> = {
  recording: "Recording",
  mixing: "Mixing",
  mastering: "Mastering",
  production: "Production",
  consultation: "Consultation",
  rehearsal: "Rehearsal",
  writing: "Writing",
};

export function serviceTint(service: string): string {
  return SERVICE_TINT[service] ?? "var(--color-ash-dim)";
}

/** How long before a deal counts as going stale. Surfaced in the legend so
 *  the amber timestamp on a card is explained rather than guessed at. */
export const STALE_AFTER_DAYS = 14;

/** Whole days elapsed since a timestamp - used for "stale deal" hints. */
export function daysSince(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
}

export type Opportunity = {
  _id: string;
  title: string;
  artistId: string;
  artistName: string;
  artistType: string;
  stage: OppStage;
  valueCents: number;
  serviceType: string;
  probability: number;
  source?: string;
  songId?: string;
  updatedAt: number;
};
