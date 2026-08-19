import type { LucideIcon } from "lucide-react";
import {
  Armchair,
  Boxes,
  Building2,
  DoorOpen,
  Drum,
  Frame,
  Headphones,
  Mic,
  PanelTop,
  Piano,
  Server,
  SlidersHorizontal,
  Speaker,
  Warehouse,
} from "lucide-react";

/* ============================================================
   What kind of place a zone is.

   A studio big enough to need this does not have "a room". It
   has a control room, a live room, a booth or two, a machine
   room down the corridor, and wall panels tying them together.
   Those are not decoration: a run that leaves the live room and
   arrives in the control room needs a tie line and a wall panel,
   and a run that stays on the desk needs a two-foot patch cord.
   Typing the zone is what lets the canvas tell those apart.

   `isRoom` marks the kinds that usually stand for a real room in
   inventory, so the properties panel can offer the binding where
   it makes sense and stay quiet where it does not - nobody has a
   "console" in their room list.
   ============================================================ */

export type ZoneKind = {
  value: string;
  label: string;
  icon: LucideIcon;
  /** One line, shown when picking. Says what belongs here, not what it is. */
  hint: string;
  /** Suggested section colour, so a canvas of zones is legible before anyone tunes it. */
  color: string;
  /** Usually stands for a room in the asset register. */
  isRoom: boolean;
};

export const ZONE_KINDS: ZoneKind[] = [
  {
    value: "controlRoom",
    label: "Control room",
    icon: SlidersHorizontal,
    hint: "The desk, the monitors, the racks either side of it.",
    color: "blue",
    isRoom: true,
  },
  {
    value: "liveRoom",
    label: "Live room",
    icon: Drum,
    hint: "The big room. Drums, amps, the mics that live on stands.",
    color: "green",
    isRoom: true,
  },
  {
    value: "vocalBooth",
    label: "Vocal booth",
    icon: Mic,
    hint: "One singer, one mic, one pair of headphones, one wall panel.",
    color: "amber",
    isRoom: true,
  },
  {
    value: "isoBooth",
    label: "Iso booth",
    icon: DoorOpen,
    hint: "The second small room. Guitar cab, upright, whatever needs its own air.",
    color: "violet",
    isRoom: true,
  },
  {
    value: "machineRoom",
    label: "Machine room",
    icon: Server,
    hint: "Converters, computers, anything you put behind a door because it has a fan.",
    color: "slate",
    isRoom: true,
  },
  {
    value: "console",
    label: "Console",
    icon: Piano,
    hint: "The desk position itself. Everything within arm's reach of the chair.",
    color: "blue",
    isRoom: false,
  },
  {
    value: "rack",
    label: "Rack",
    icon: Boxes,
    hint: "One rack of outboard, as a unit. Move the rack, move the map.",
    color: "slate",
    isRoom: false,
  },
  {
    value: "wallPanel",
    label: "Wall panel",
    icon: PanelTop,
    hint: "The plate on the wall and the tie lines behind it.",
    color: "red",
    isRoom: false,
  },
  {
    value: "monitoring",
    label: "Monitoring",
    icon: Speaker,
    hint: "Mains, nearfields, the monitor controller feeding them.",
    color: "violet",
    isRoom: false,
  },
  {
    value: "cue",
    label: "Cue / headphones",
    icon: Headphones,
    hint: "The headphone amp and every box hanging off it.",
    color: "green",
    isRoom: false,
  },
  {
    value: "lounge",
    label: "Lounge",
    icon: Armchair,
    hint: "Where the clients sit. Playback and nothing that matters.",
    color: "amber",
    isRoom: true,
  },
  {
    value: "storage",
    label: "Storage",
    icon: Warehouse,
    hint: "Gear that is in the building but not in the signal path.",
    color: "slate",
    isRoom: true,
  },
  {
    value: "zone",
    label: "Plain zone",
    icon: Frame,
    hint: "A named area with no particular meaning.",
    color: "amber",
    isRoom: false,
  },
];

const BY_VALUE = new Map(ZONE_KINDS.map((k) => [k.value, k]));

/** Resolve a stored kind. An unknown one reads as a plain zone rather than breaking. */
export function zoneKind(value: string | null | undefined): ZoneKind {
  return (value ? BY_VALUE.get(value) : undefined) ?? BY_VALUE.get("zone")!;
}

/** The kinds that usually stand for a real room, for the room-binding UI. */
export const ROOM_LIKE_KINDS = new Set(ZONE_KINDS.filter((k) => k.isRoom).map((k) => k.value));

/** Icon for a facility that is not one of ours - only used as a last resort. */
export const FACILITY_ICON = Building2;
