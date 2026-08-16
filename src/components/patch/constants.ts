import type { LucideIcon } from "lucide-react";
import {
  Cable,
  Circle,
  Cpu,
  Gauge,
  Mic,
  Plug,
  Radio,
  Speaker,
  Usb,
  Waves,
} from "lucide-react";

/* Display vocabulary for the patch canvas. Signal level drives colour,
   because level is the thing that bites: a mic output into a line input
   is silence, and a line output into a mic input is distortion. Making
   level legible at a glance is most of the value of drawing this at all. */

export type SignalLevel =
  | "mic"
  | "line"
  | "instrument"
  | "speaker"
  | "digital"
  | "control";

export type PortDirection = "input" | "output" | "bidirectional";

export const SIGNAL_LEVELS: {
  value: SignalLevel;
  label: string;
  short: string;
  /** Stroke for edges and the port dot. */
  color: string;
  icon: LucideIcon;
}[] = [
  { value: "mic", label: "Mic level", short: "MIC", color: "#fdb913", icon: Mic },
  { value: "line", label: "Line level", short: "LINE", color: "#5db4ff", icon: Waves },
  { value: "instrument", label: "Instrument", short: "INST", color: "#3ddc91", icon: Gauge },
  { value: "speaker", label: "Speaker", short: "SPKR", color: "#ff5d5d", icon: Speaker },
  { value: "digital", label: "Digital", short: "DIG", color: "#c39bff", icon: Cpu },
  { value: "control", label: "Control", short: "CTRL", color: "#8b8b95", icon: Radio },
];

const LEVEL_BY_VALUE = new Map(SIGNAL_LEVELS.map((l) => [l.value, l]));

export function levelMeta(level: string) {
  return (
    LEVEL_BY_VALUE.get(level as SignalLevel) ?? {
      value: level as SignalLevel,
      label: level,
      short: level.toUpperCase().slice(0, 4),
      color: "#8b8b95",
      icon: Circle,
    }
  );
}

export type ConnectorType =
  | "xlr"
  | "trs"
  | "ts"
  | "db25"
  | "bantam"
  | "bnc"
  | "rj45"
  | "speakon"
  | "rca"
  | "midi_din"
  | "usb"
  | "thunderbolt"
  | "adat_optical"
  | "spdif_coax"
  | "banana"
  | "other";

export const CONNECTORS: { value: ConnectorType; label: string; short: string }[] = [
  { value: "xlr", label: "XLR", short: "XLR" },
  { value: "trs", label: "TRS (balanced jack)", short: "TRS" },
  { value: "ts", label: "TS (unbalanced jack)", short: "TS" },
  { value: "db25", label: "DB25", short: "DB25" },
  { value: "bantam", label: "Bantam / TT", short: "TT" },
  { value: "bnc", label: "BNC", short: "BNC" },
  { value: "rj45", label: "RJ45", short: "RJ45" },
  { value: "speakon", label: "SpeakOn", short: "SPK" },
  { value: "rca", label: "RCA", short: "RCA" },
  { value: "midi_din", label: "MIDI DIN", short: "MIDI" },
  { value: "usb", label: "USB", short: "USB" },
  { value: "thunderbolt", label: "Thunderbolt", short: "TB" },
  { value: "adat_optical", label: "ADAT optical", short: "ADAT" },
  { value: "spdif_coax", label: "S/PDIF coax", short: "SPDIF" },
  { value: "banana", label: "Banana", short: "BAN" },
  { value: "other", label: "Other", short: "OTH" },
];

const CONNECTOR_BY_VALUE = new Map(CONNECTORS.map((c) => [c.value, c]));

export function connectorMeta(connector: string) {
  return (
    CONNECTOR_BY_VALUE.get(connector as ConnectorType) ?? {
      value: connector as ConnectorType,
      label: connector,
      short: connector.toUpperCase().slice(0, 5),
    }
  );
}

export const CAPABILITIES: { value: string; label: string; short: string; hint: string }[] = [
  { value: "phantom", label: "Phantom power", short: "48V", hint: "Sends 48 volts up the mic line" },
  { value: "pad", label: "Pad", short: "PAD", hint: "Attenuates a hot source before the preamp" },
  { value: "polarity", label: "Polarity invert", short: "Ø", hint: "Flips the waveform 180 degrees" },
  { value: "monoSum", label: "Mono sum", short: "MONO", hint: "Sums the stereo pair to one signal" },
  { value: "hpf", label: "High-pass filter", short: "HPF", hint: "Rolls off the low end" },
  { value: "impedance", label: "Impedance", short: "Ω", hint: "Changes the input load" },
];

const CAPABILITY_BY_VALUE = new Map(CAPABILITIES.map((c) => [c.value, c]));

export function capabilityMeta(capability: string) {
  return (
    CAPABILITY_BY_VALUE.get(capability) ?? {
      value: capability,
      label: capability,
      short: capability.slice(0, 4).toUpperCase(),
      hint: "",
    }
  );
}

/** Icon for a device category on the canvas and in the palette. */
export const PATCH_CATEGORY_ICONS: Record<string, LucideIcon> = {
  patchbay: Plug,
  cable: Cable,
  interface: Usb,
  preamp: Gauge,
  mic: Mic,
  monitor: Speaker,
};

/**
 * Above this many connections the directional flow animation turns
 * itself off. Animating hundreds of dashed strokes is the fastest way
 * to make a large room's patch map unusable on a laptop.
 */
export const ANIMATION_CONNECTION_LIMIT = 120;

/** Above this many ports a device card collapses its port list by default. */
export const PORT_COLLAPSE_LIMIT = 14;

/** Canvas grid, in px. Snap lands on this. */
export const GRID = 16;

/** Jacket colours offered when labelling a cable run. */
export const CABLE_COLORS: { value: string; label: string; hex: string }[] = [
  { value: "black", label: "Black", hex: "#4a4a52" },
  { value: "red", label: "Red", hex: "#ff5d5d" },
  { value: "blue", label: "Blue", hex: "#5db4ff" },
  { value: "green", label: "Green", hex: "#3ddc91" },
  { value: "yellow", label: "Yellow", hex: "#fdb913" },
  { value: "orange", label: "Orange", hex: "#ff9f43" },
  { value: "purple", label: "Purple", hex: "#c39bff" },
  { value: "white", label: "White", hex: "#e8e8ea" },
];

const COLOR_BY_VALUE = new Map(CABLE_COLORS.map((c) => [c.value, c]));

/** Resolve a stored colour name to a hex the canvas can stroke with. */
export function cableColorHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const known = COLOR_BY_VALUE.get(color.toLowerCase());
  if (known) return known.hex;
  // Allow a raw hex the studio typed in themselves.
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : null;
}
