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

/** Service-type color hint - drives the left rail tint on each deal card. */
export const SERVICE_TINT: Record<string, string> = {
  recording: "var(--color-info)",
  mixing: "var(--color-caution)",
  mastering: "var(--color-gold)",
  production: "var(--color-gold-bright)",
  consultation: "var(--color-ash)",
  rehearsal: "var(--color-positive)",
  writing: "var(--color-gold-deep)",
};

export function serviceTint(service: string): string {
  return SERVICE_TINT[service] ?? "var(--color-ash-dim)";
}

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
