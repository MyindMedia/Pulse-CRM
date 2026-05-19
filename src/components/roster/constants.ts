/** Shared roster enums — kept here so dialogs and filters agree. */

export const ARTIST_TYPES = [
  { value: "artist", label: "Artist" },
  { value: "producer", label: "Producer" },
  { value: "band", label: "Band" },
  { value: "label", label: "Label" },
  { value: "songwriter", label: "Songwriter" },
  { value: "other", label: "Other" },
] as const;

export type ArtistType = (typeof ARTIST_TYPES)[number]["value"];

export const ARTIST_STATUSES = [
  { value: "lead", label: "Lead" },
  { value: "active", label: "Active" },
  { value: "vip", label: "VIP" },
  { value: "dormant", label: "Dormant" },
] as const;

export type ArtistStatusValue = (typeof ARTIST_STATUSES)[number]["value"];

export const RELIABILITY_LEVELS = [
  { value: "solid", label: "Solid" },
  { value: "watch", label: "Watch" },
  { value: "flagged", label: "Flagged" },
] as const;

export type ReliabilityValue = (typeof RELIABILITY_LEVELS)[number]["value"];

export function artistTypeLabel(type: string): string {
  return ARTIST_TYPES.find((t) => t.value === type)?.label ?? type;
}
