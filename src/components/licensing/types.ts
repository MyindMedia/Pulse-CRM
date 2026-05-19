import type { Id } from "@convex/_generated/dataModel";

/** Sync placement stage values, ordered as a pipeline. */
export type SyncStage =
  | "pitched"
  | "heard"
  | "shortlisted"
  | "negotiating"
  | "placed"
  | "passed";

export const SYNC_STAGE_ORDER: SyncStage[] = [
  "pitched",
  "heard",
  "shortlisted",
  "negotiating",
  "placed",
  "passed",
];

/** A sync opportunity as returned by api.licensing.syncBoard. */
export type SyncOpportunity = {
  _id: Id<"syncOpportunities">;
  songId: Id<"songs">;
  songTitle: string;
  supervisorName: string;
  outlet: string;
  stage: SyncStage;
  feeCents?: number;
  updatedAt: number;
};

/** Beat license tier values. */
export type LicenseTier = "mp3" | "wav" | "trackout" | "exclusive";

/** A beat license as returned by api.licensing.allLicenses. */
export type BeatLicense = {
  _id: Id<"licenses">;
  songId: Id<"songs">;
  songTitle: string;
  buyerName: string;
  buyerArtistId?: Id<"artists">;
  tier: LicenseTier;
  priceCents: number;
  termMonths?: number;
  streamCap?: number;
  active: boolean;
  soldAt: number;
};

/** A song option for the licensing pickers. */
export type SongOption = {
  _id: Id<"songs">;
  title: string;
  stage: string;
};

/** An artist roster entry. */
export type RosterArtist = {
  _id: Id<"artists">;
  name: string;
  type: string;
  avatarColor: string;
};

/** The next stage a sync card can be advanced to, or null at a terminal stage. */
export function nextSyncStage(stage: SyncStage): SyncStage | null {
  const forward: Partial<Record<SyncStage, SyncStage>> = {
    pitched: "heard",
    heard: "shortlisted",
    shortlisted: "negotiating",
    negotiating: "placed",
  };
  return forward[stage] ?? null;
}
