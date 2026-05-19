/* ============================================================
   Studio module enums — room status, member roles, and the
   equipment category / status display maps shared by the
   Studio room cards and the Inventory page. One source of
   truth for both modules; kept DRY and type-correct.
   ============================================================ */

import {
  Boxes,
  Cable,
  Mic,
  Music,
  Package,
  SlidersHorizontal,
  Speaker,
  type LucideIcon,
} from "lucide-react";

export type RoomStatus = "available" | "in_use" | "maintenance" | "retired";
export type MemberRole =
  | "owner"
  | "manager"
  | "engineer"
  | "assistant_engineer"
  | "artist_relations"
  | "producer"
  | "intern"
  | "accountant";
export type EquipmentCategory =
  | "console"
  | "mic"
  | "outboard"
  | "instrument"
  | "monitor"
  | "rig"
  | "other";
export type EquipmentStatus = "available" | "in_use" | "maintenance" | "retired";

type Tone = "neutral" | "gold" | "positive" | "caution" | "critical" | "info" | "solid";

/* ------------------------------------------------------------
   Rooms
   ------------------------------------------------------------ */

/** Status display map — label + Badge tone. Used for both rooms and gear. */
export const ROOM_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "positive" },
  in_use: { label: "In use", tone: "info" },
  maintenance: { label: "Maintenance", tone: "caution" },
  retired: { label: "Retired", tone: "neutral" },
};

export const ROOM_STATUSES: { value: RoomStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
];

/** Common room types — offered in the Add room picker, free text still allowed. */
export const ROOM_TYPES: string[] = [
  "Live room",
  "Mix suite",
  "Writing room",
  "Vocal booth",
  "Mastering room",
];

/* ------------------------------------------------------------
   Equipment — category metadata + status display
   ------------------------------------------------------------ */

/** Category metadata — label, plural, and the lucide icon per category. */
export const EQUIPMENT_CATEGORIES: {
  value: EquipmentCategory;
  label: string;
  plural: string;
  icon: LucideIcon;
}[] = [
  { value: "console", label: "Console", plural: "Consoles", icon: SlidersHorizontal },
  { value: "mic", label: "Microphone", plural: "Microphones", icon: Mic },
  { value: "outboard", label: "Outboard", plural: "Outboard", icon: Boxes },
  { value: "instrument", label: "Instrument", plural: "Instruments", icon: Music },
  { value: "monitor", label: "Monitor", plural: "Monitors", icon: Speaker },
  { value: "rig", label: "Rig", plural: "Rigs", icon: Cable },
  { value: "other", label: "Other", plural: "Other", icon: Package },
];

const CATEGORY_BY_VALUE = new Map(EQUIPMENT_CATEGORIES.map((c) => [c.value, c]));

/** Resolve category metadata, with a safe fallback for unknown values. */
export function categoryMeta(category: string) {
  return (
    CATEGORY_BY_VALUE.get(category as EquipmentCategory) ?? {
      value: category as EquipmentCategory,
      label: category,
      plural: category,
      icon: Package,
    }
  );
}

/** Equipment status display map — label + Badge tone. */
export const EQUIPMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "positive" },
  in_use: { label: "In use", tone: "info" },
  maintenance: { label: "Maintenance", tone: "caution" },
  retired: { label: "Retired", tone: "neutral" },
};

export const EQUIPMENT_STATUSES: { value: EquipmentStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
];

/** Resolve a status display entry, with a safe fallback. */
export function statusMeta(status: string) {
  return EQUIPMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
}

/* ------------------------------------------------------------
   Team roles
   ------------------------------------------------------------ */

/** Team role display map — label + Badge tone. */
export const MEMBER_ROLE: Record<string, { label: string; tone: Tone }> = {
  owner:              { label: "Owner",             tone: "solid" },
  manager:            { label: "Manager",           tone: "gold" },
  engineer:           { label: "Engineer",          tone: "info" },
  assistant_engineer: { label: "Asst. engineer",    tone: "info" },
  artist_relations:   { label: "Artist relations",  tone: "info" },
  producer:           { label: "Producer",          tone: "gold" },
  intern:             { label: "Intern",            tone: "neutral" },
  accountant:         { label: "Accountant",        tone: "caution" },
};

export const MEMBER_ROLES: { value: MemberRole; label: string; blurb: string }[] = [
  {
    value: "owner",
    label: "Owner",
    blurb: "Full access — workspace settings, billing, the team and every record.",
  },
  {
    value: "manager",
    label: "Manager",
    blurb: "Runs bookings and clients. Manages the calendar, pipeline and invoicing.",
  },
  {
    value: "engineer",
    label: "Engineer",
    blurb: "Works the floor — runs sessions, logs takes and updates song progress.",
  },
  {
    value: "assistant_engineer",
    label: "Assistant engineer",
    blurb: "Narrower scope — runs assigned sessions and uploads stems, no approvals.",
  },
  {
    value: "artist_relations",
    label: "Artist relations",
    blurb: "Front-of-house — books sessions, edits artists, runs the pipeline.",
  },
  {
    value: "producer",
    label: "Producer",
    blurb: "In-house producer — runs sessions, signs split sheets, drives a song.",
  },
  {
    value: "intern",
    label: "Intern",
    blurb: "Read-only — see everything, change nothing.",
  },
  {
    value: "accountant",
    label: "Accountant",
    blurb: "Money only — invoices, payments, refunds, licensing. No creative access.",
  },
];
