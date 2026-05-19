import type { Id } from "@convex/_generated/dataModel";

/** A single rollout step inside a release campaign. */
export type CampaignTask = {
  label: string;
  offsetDays: number;
  done: boolean;
  owner?: string;
};

/** A release campaign as returned by api.releases.list. */
export type Campaign = {
  _id: Id<"releaseCampaigns">;
  songId: Id<"songs">;
  songTitle: string;
  artistName: string;
  releaseDate: number;
  status: "planning" | "active" | "released";
  progress: number;
  taskCount: number;
  doneCount: number;
  tasks: CampaignTask[];
};

/** A song option for the campaign builder picker. */
export type SongOption = {
  _id: Id<"songs">;
  title: string;
  stage: string;
};

/** Render an offsetDays integer as a studio-style rollout marker. */
export function offsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return "Release day";
  if (offsetDays < 0) return `D-${Math.abs(offsetDays)}`;
  return `D+${offsetDays}`;
}
