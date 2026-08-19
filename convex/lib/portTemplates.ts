/* ============================================================
   PORT TEMPLATES - the I/O half of the gear library.

   `gearCatalog.ts` knows what a piece of gear is called and what
   it costs. It does not know what you can plug into it. This file
   supplies that: for a given catalog slug or equipment category,
   the list of ports the unit exposes, at channel level.

   Two layers, deliberately:

   1. CATALOG_PORTS - hand-written templates for the devices a
      studio actually patches around. Accurate I/O counts.
   2. CATEGORY_DEFAULTS - a sane fallback for every equipment
      category. This is what lets any of the ~180 catalog models,
      and any custom item a studio types in, land on the canvas
      with usable ports instead of nothing at all.

   A profile is a starting point, never a cage. Ports are copied
   onto the device instance at placement time, so an engineer can
   rename, add or delete ports on their unit without editing the
   shared profile, and a later profile edit can never silently
   rewrite a patch someone already documented.
   ============================================================ */

export type PortDirection = "input" | "output" | "bidirectional";

export type SignalLevel =
  | "mic"
  | "line"
  | "instrument"
  | "speaker"
  | "digital"
  | "control";

import type { ConnectorValue, Gender } from "./connectors";
import { conventionalPortGender } from "./connectors";

export type ConnectorType = ConnectorValue;

export type PortCapability =
  | "phantom"
  | "pad"
  | "polarity"
  | "monoSum"
  | "hpf"
  | "impedance";

export type NormallingMode = "full" | "half" | "none";

export type PortTemplate = {
  label: string;
  direction: PortDirection;
  signalLevel: SignalLevel;
  connector: ConnectorType;
  gender?: Gender;
  channelIndex?: number;
  capabilities: PortCapability[];
  bayRow?: "top" | "bottom";
  bayColumn?: number;
};

export type ProfileSeed = {
  /** gearCatalog slug when one exists, otherwise a patch-manager-only slug. */
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  rackUnits?: number;
  phantomSensitive?: boolean;
  defaultNormalling?: NormallingMode;
  ports: PortTemplate[];
};

/* ── Builders ───────────────────────────────────────────────── */

/** One port. */
export function port(
  label: string,
  direction: PortDirection,
  signalLevel: SignalLevel,
  connector: ConnectorType,
  capabilities: PortCapability[] = [],
  channelIndex?: number,
): PortTemplate {
  return {
    label,
    direction,
    signalLevel,
    connector,
    // A jack on a chassis has a conventional gender: an XLR output is male,
    // an XLR input female, and everything else on a panel is a socket.
    // Recording it is what lets the cable check catch two males.
    gender: conventionalPortGender(connector, direction),
    capabilities,
    channelIndex,
  };
}

/**
 * A run of numbered channel ports. `In 1`..`In 8`, each its own row.
 * This is the rule the whole feature rests on: a multi-channel
 * connector is never collapsed into a single port.
 */
export function channels(
  count: number,
  labelPrefix: string,
  direction: PortDirection,
  signalLevel: SignalLevel,
  connector: ConnectorType,
  capabilities: PortCapability[] = [],
  startIndex = 1,
): PortTemplate[] {
  return Array.from({ length: count }, (_, i) =>
    port(
      `${labelPrefix} ${startIndex + i}`,
      direction,
      signalLevel,
      connector,
      capabilities,
      startIndex + i,
    ),
  );
}

/** A stereo pair, labelled L and R. */
export function stereo(
  labelPrefix: string,
  direction: PortDirection,
  signalLevel: SignalLevel,
  connector: ConnectorType,
  capabilities: PortCapability[] = [],
): PortTemplate[] {
  return [
    port(`${labelPrefix} L`, direction, signalLevel, connector, capabilities, 1),
    port(`${labelPrefix} R`, direction, signalLevel, connector, capabilities, 2),
  ];
}

/**
 * A patchbay. `points` is the number of columns; each column has a
 * top jack and a bottom jack. Top is conventionally the source
 * (an output arriving at the bay) and bottom the destination.
 * Geometry is recorded so normalling can be derived rather than
 * hand-wired, which is what stops the map lying about where audio
 * actually goes once nothing is plugged in.
 */
export function patchbay(
  points: number,
  connector: ConnectorType = "bantam",
): PortTemplate[] {
  const out: PortTemplate[] = [];
  for (let col = 1; col <= points; col++) {
    out.push({
      label: `Top ${col}`,
      direction: "input",
      signalLevel: "line",
      connector,
      gender: conventionalPortGender(connector, "input"),
      channelIndex: col,
      capabilities: [],
      bayRow: "top",
      bayColumn: col,
    });
    out.push({
      label: `Bottom ${col}`,
      direction: "output",
      signalLevel: "line",
      connector,
      gender: conventionalPortGender(connector, "output"),
      channelIndex: col,
      capabilities: [],
      bayRow: "bottom",
      bayColumn: col,
    });
  }
  return out;
}

/**
 * A wall panel: the plate of connectors that lets one room reach
 * another. Every jack is bidirectional on purpose.
 *
 * A tie line is copper, and copper does not care which way you use
 * it. The same booth panel jack takes a mic on Monday and feeds a
 * cue box on Tuesday, so recording a fixed direction would make the
 * map wrong half the time. Direction lives on the RUN - which end
 * you plugged the source into - not on the plate screwed to the wall.
 */
export function wallPanel(
  count: number,
  connector: ConnectorType = "xlr3",
  labelPrefix = "XLR",
  signalLevel: SignalLevel = "mic",
  startIndex = 1,
): PortTemplate[] {
  return Array.from({ length: count }, (_, i) => ({
    label: `${labelPrefix} ${startIndex + i}`,
    direction: "bidirectional" as PortDirection,
    signalLevel,
    connector,
    // A panel jack is a socket whichever way the signal runs.
    gender: conventionalPortGender(connector, "input"),
    channelIndex: startIndex + i,
    capabilities: [] as PortCapability[],
  }));
}

/* ── Category fallbacks ─────────────────────────────────────────
   Every equipment category resolves to something placeable. These
   are intentionally modest: a plausible minimum an engineer can
   extend, not a guess at a specific model's rear panel.
   ──────────────────────────────────────────────────────────────*/

export const CATEGORY_DEFAULTS: Record<string, () => PortTemplate[]> = {
  mic: () => [port("Out", "output", "mic", "xlr3", ["polarity"])],

  // A plain four-way XLR plate: the smallest thing anyone screws to a wall.
  wallPanel: () => wallPanel(4, "xlr3", "XLR"),

  preamp: () => [
    port("Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"], 1),
    port("Line Out", "output", "line", "xlr3", [], 1),
  ],

  interface: () => [
    ...channels(2, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad"]),
    ...stereo("Main Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],

  console: () => [
    ...channels(8, "Ch In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf"]),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...stereo("Monitor Out", "output", "line", "trs"),
  ],

  outboard: () => [
    port("In", "input", "line", "xlr3", ["pad"], 1),
    port("Out", "output", "line", "xlr3", [], 1),
    port("Sidechain", "input", "line", "trs", [], 1),
  ],

  monitor: () => [
    port("In", "input", "line", "xlr3", []),
    port("Driver", "input", "speaker", "speakon", []),
  ],

  monitor_controller: () => [
    ...stereo("Source A In", "input", "line", "trs"),
    ...stereo("Speaker A Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
  ],

  headphones: () => [port("In", "input", "line", "trs", [])],

  synth: () => [
    ...stereo("Audio Out", "output", "line", "ts"),
    port("MIDI In", "input", "control", "midi_din"),
    port("MIDI Out", "output", "control", "midi_din"),
  ],

  midi: () => [
    port("MIDI Out", "output", "control", "midi_din"),
    port("USB", "bidirectional", "control", "usb_b"),
  ],

  instrument: () => [port("Out", "output", "instrument", "ts", [])],

  computer: () => [
    port("Thunderbolt", "bidirectional", "digital", "thunderbolt"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],

  rig: () => [
    port("Thunderbolt", "bidirectional", "digital", "thunderbolt"),
    ...channels(8, "Analog In", "input", "line", "db25"),
    ...channels(8, "Analog Out", "output", "line", "db25"),
  ],

  patchbay: () => patchbay(48),

  cable: () => [],
  furniture: () => [],
  acoustic: () => [],
  decor: () => [],
  other: () => [port("In", "input", "line", "trs"), port("Out", "output", "line", "trs")],
};

/* ── Hand-written templates for gear that gets patched ──────────
   Keyed by gearCatalog slug so a profile and the Add-equipment
   prefill describe the same unit. Anything absent here still
   works, it just falls back to its category default above.
   ──────────────────────────────────────────────────────────────*/

export const CATALOG_PORTS: Record<string, PortTemplate[]> = {
  // ── Interfaces ──
  "ua-apollo-x8p": [
    ...channels(8, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"]),
    ...channels(8, "Line Out", "output", "line", "db25"),
    ...stereo("Monitor Out", "output", "line", "trs"),
    ...channels(2, "Headphone Out", "output", "line", "trs"),
    ...channels(8, "ADAT In", "input", "digital", "adat_optical"),
    ...channels(8, "ADAT Out", "output", "digital", "adat_optical"),
    port("Word Clock In", "input", "control", "bnc"),
    port("Word Clock Out", "output", "control", "bnc"),
    port("Thunderbolt", "bidirectional", "digital", "thunderbolt"),
  ],
  "ua-apollo-x16": [
    ...channels(16, "Line In", "input", "line", "db25"),
    ...channels(16, "Line Out", "output", "line", "db25"),
    ...stereo("Monitor Out", "output", "line", "trs"),
    port("Word Clock In", "input", "control", "bnc"),
    port("Word Clock Out", "output", "control", "bnc"),
    port("Thunderbolt", "bidirectional", "digital", "thunderbolt"),
  ],
  "ua-apollo-twin-x-duo": [
    ...channels(2, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"]),
    port("Hi-Z In", "input", "instrument", "ts", ["impedance"]),
    ...stereo("Monitor Out", "output", "line", "trs"),
    ...stereo("Line Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
    port("Thunderbolt", "bidirectional", "digital", "thunderbolt"),
  ],
  "focusrite-scarlett-18i20-4g": [
    ...channels(8, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad", "hpf"]),
    ...channels(10, "Line Out", "output", "line", "trs"),
    ...channels(8, "ADAT In", "input", "digital", "adat_optical"),
    ...channels(8, "ADAT Out", "output", "digital", "adat_optical"),
    ...channels(2, "Headphone Out", "output", "line", "trs"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],
  "focusrite-scarlett-2i2-4g": [
    ...channels(2, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad"]),
    ...stereo("Monitor Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],
  "rme-fireface-ufx-iii": [
    ...channels(4, "Mic/Line In", "input", "mic", "xlr3", ["phantom", "pad"]),
    ...channels(8, "Line In", "input", "line", "trs", [], 5),
    ...channels(8, "Line Out", "output", "line", "trs"),
    ...channels(8, "ADAT In", "input", "digital", "adat_optical"),
    ...channels(8, "ADAT Out", "output", "digital", "adat_optical"),
    port("Word Clock In", "input", "control", "bnc"),
    port("Word Clock Out", "output", "control", "bnc"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],

  // ── Preamps ──
  "neve-1073dpx": [
    ...channels(2, "Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"]),
    ...channels(2, "Line In", "input", "line", "xlr3", ["polarity"]),
    ...channels(2, "DI In", "input", "instrument", "ts", ["impedance"]),
    ...channels(2, "Out", "output", "line", "xlr3"),
  ],
  "neve-1073spx": [
    port("Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"], 1),
    port("Line In", "input", "line", "xlr3", ["polarity"], 1),
    port("DI In", "input", "instrument", "ts", ["impedance"], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],
  "api-512c": [
    port("Mic In", "input", "mic", "xlr3", ["phantom", "polarity", "impedance"], 1),
    port("DI In", "input", "instrument", "ts", ["impedance"], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],
  "api-3124v": [
    ...channels(4, "Mic In", "input", "mic", "xlr3", ["phantom", "polarity", "pad"]),
    ...channels(4, "DI In", "input", "instrument", "ts", ["impedance"]),
    ...channels(4, "Out", "output", "line", "xlr3"),
    port("Multi Out", "output", "line", "db25"),
  ],
  "focusrite-isa428-mk2": [
    ...channels(4, "Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"]),
    ...channels(4, "Line In", "input", "line", "trs"),
    ...channels(4, "Insert Send", "output", "line", "trs"),
    ...channels(4, "Insert Return", "input", "line", "trs"),
    ...channels(4, "Out", "output", "line", "db25"),
  ],
  "warm-wa73": [
    port("Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf", "impedance"], 1),
    port("DI In", "input", "instrument", "ts", ["impedance"], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],
  "ua-610-solo": [
    port("Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "impedance"], 1),
    port("DI In", "input", "instrument", "ts", ["impedance"], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],

  // ── Outboard ──
  "ua-1176ln": [
    port("In", "input", "line", "xlr3", [], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],
  "ua-la2a": [
    port("In", "input", "line", "xlr3", [], 1),
    port("Out", "output", "line", "xlr3", [], 1),
  ],
  "empirical-distressor": [
    port("In", "input", "line", "xlr3", [], 1),
    port("Out", "output", "line", "xlr3", [], 1),
    port("Detector In", "input", "line", "trs", [], 1),
  ],
  "ssl-g-bus-comp": [
    ...stereo("In", "input", "line", "xlr3"),
    ...stereo("Out", "output", "line", "xlr3"),
    port("Sidechain In", "input", "line", "trs"),
  ],
  "tubetech-cl1b": [
    port("In", "input", "line", "xlr3", [], 1),
    port("Out", "output", "line", "xlr3", [], 1),
    port("Sidechain", "input", "line", "trs", [], 1),
  ],
  "api-2500": [
    ...stereo("In", "input", "line", "xlr3"),
    ...stereo("Out", "output", "line", "xlr3"),
    ...stereo("Sidechain In", "input", "line", "trs"),
  ],

  // ── Consoles ──
  "ssl-origin": [
    ...channels(32, "Ch Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity", "hpf"]),
    ...channels(32, "Ch Line In", "input", "line", "db25"),
    ...channels(32, "Ch Insert Send", "output", "line", "db25"),
    ...channels(32, "Ch Insert Return", "input", "line", "db25"),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...channels(8, "Bus Out", "output", "line", "db25"),
    ...stereo("Monitor Out", "output", "line", "trs"),
  ],
  "ssl-xl-desk": [
    ...channels(16, "Ch Line In", "input", "line", "db25"),
    ...channels(16, "Ch Insert Send", "output", "line", "db25"),
    ...channels(16, "Ch Insert Return", "input", "line", "db25"),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...stereo("Monitor Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
  ],
  "ssl-six": [
    ...channels(2, "Mic In", "input", "mic", "xlr3", ["phantom", "pad", "hpf"]),
    ...channels(4, "Line In", "input", "line", "trs"),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...stereo("Monitor Out", "output", "line", "trs"),
    port("Headphone Out", "output", "line", "trs"),
  ],
  "api-1608-ii": [
    ...channels(16, "Ch Mic In", "input", "mic", "xlr3", ["phantom", "pad", "polarity"]),
    ...channels(16, "Ch Line In", "input", "line", "db25"),
    ...channels(16, "Ch Insert Send", "output", "line", "db25"),
    ...channels(16, "Ch Insert Return", "input", "line", "db25"),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...channels(8, "Bus Out", "output", "line", "db25"),
  ],
  "neve-8424": [
    ...channels(24, "Ch Line In", "input", "line", "db25"),
    ...channels(24, "Ch Insert Send", "output", "line", "db25"),
    ...channels(24, "Ch Insert Return", "input", "line", "db25"),
    ...stereo("Mix Out", "output", "line", "xlr3"),
    ...stereo("Monitor Out", "output", "line", "trs"),
  ],

  // ── Monitor controllers ──
  "ssl-uf8": [port("USB", "bidirectional", "control", "usb_b")],
  "mackie-big-knob-studio": [
    ...stereo("Source A In", "input", "line", "trs"),
    ...stereo("Source B In", "input", "line", "trs"),
    ...stereo("Speaker A Out", "output", "line", "trs"),
    ...stereo("Speaker B Out", "output", "line", "trs"),
    ...channels(2, "Mic In", "input", "mic", "xlr3", ["phantom"]),
    ...channels(2, "Headphone Out", "output", "line", "trs"),
    port("USB", "bidirectional", "digital", "usb_b"),
  ],

  // ── Monitors ──
  "yamaha-hs8": [
    port("XLR In", "input", "line", "xlr3", []),
    port("TRS In", "input", "line", "trs", []),
  ],

  // ── Ribbon mics: phantom power is the thing that kills them ──
  "royer-r121": [port("Out", "output", "mic", "xlr3", ["polarity"])],
  "aea-r84": [port("Out", "output", "mic", "xlr3", ["polarity"])],
  "coles-4038": [port("Out", "output", "mic", "xlr3", ["polarity"])],

  // ── Condenser and dynamic mics ──
  "neumann-u87-ai": [port("Out", "output", "mic", "xlr3", ["pad", "polarity", "hpf"])],
  "akg-c414-xlii": [port("Out", "output", "mic", "xlr3", ["pad", "polarity", "hpf"])],
  "shure-sm7b": [port("Out", "output", "mic", "xlr3", ["polarity"])],
  "shure-sm57": [port("Out", "output", "mic", "xlr3", ["polarity"])],
};

/** Catalog slugs whose gear is destroyed or degraded by phantom power. */
export const PHANTOM_SENSITIVE = new Set<string>([
  "royer-r121",
  "aea-r84",
  "coles-4038",
]);

/* ── Patch-manager-only profiles ────────────────────────────────
   The gear catalog has no patchbay category at all, and a patch
   document without patchbays is a patch document about a bedroom.
   These fill the gap, plus the DI and snake every session needs.
   ──────────────────────────────────────────────────────────────*/

export const EXTRA_PROFILES: ProfileSeed[] = [
  {
    id: "patchbay-tt-96",
    name: "TT Patchbay 96-point",
    manufacturer: "Generic",
    category: "patchbay",
    rackUnits: 1,
    defaultNormalling: "half",
    ports: patchbay(48, "bantam"),
  },
  {
    id: "patchbay-trs-48",
    name: "TRS Patchbay 48-point",
    manufacturer: "Generic",
    category: "patchbay",
    rackUnits: 1,
    defaultNormalling: "half",
    ports: patchbay(24, "trs"),
  },
  {
    id: "patchbay-xlr-24",
    name: "XLR Patchbay 24-point",
    manufacturer: "Generic",
    category: "patchbay",
    rackUnits: 2,
    defaultNormalling: "none",
    ports: patchbay(12, "xlr3"),
  },
  /* Wall panels. The gear nobody buys and every multi-room studio has:
     the plate by the booth door, the floor box under the drums, the tie
     lines that make a room-to-room patch possible at all. */
  {
    id: "wall-panel-xlr-4",
    name: "Wall Panel 4x XLR",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: wallPanel(4, "xlr3", "XLR"),
  },
  {
    id: "wall-panel-xlr-8",
    name: "Wall Panel 8x XLR",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: wallPanel(8, "xlr3", "XLR"),
  },
  {
    id: "wall-panel-xlr-12",
    name: "Wall Panel 12x XLR",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: wallPanel(12, "xlr3", "XLR"),
  },
  {
    id: "wall-panel-trs-8",
    name: "Wall Panel 8x TRS",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: wallPanel(8, "trs", "TRS", "line"),
  },
  {
    id: "floor-box-xlr-4-trs-2",
    name: "Floor Box 4x XLR + 2x TRS",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: [
      ...wallPanel(4, "xlr3", "XLR"),
      ...wallPanel(2, "trs", "TRS", "line"),
    ],
  },
  {
    id: "wall-panel-network-4",
    name: "Wall Panel 4x RJ45",
    manufacturer: "Generic",
    category: "wallPanel",
    ports: wallPanel(4, "rj45", "Net", "digital"),
  },
  {
    id: "di-passive-single",
    name: "Passive DI Box",
    manufacturer: "Generic",
    category: "other",
    ports: [
      port("Instrument In", "input", "instrument", "ts", ["impedance"], 1),
      port("Thru", "output", "instrument", "ts", [], 1),
      port("Mic Out", "output", "mic", "xlr3", ["polarity"], 1),
    ],
  },
  {
    id: "di-active-dual",
    name: "Active DI Box (dual)",
    manufacturer: "Generic",
    category: "other",
    ports: [
      ...channels(2, "Instrument In", "input", "instrument", "ts", ["impedance", "pad"]),
      ...channels(2, "Mic Out", "output", "mic", "xlr3", ["polarity"]),
    ],
  },
  {
    id: "snake-db25-8ch",
    name: "DB25 Snake 8-channel",
    manufacturer: "Generic",
    category: "cable",
    ports: [
      ...channels(8, "A", "input", "line", "db25"),
      ...channels(8, "B", "output", "line", "db25"),
    ],
  },
  {
    id: "headphone-amp-4ch",
    name: "Headphone Amp 4-channel",
    manufacturer: "Generic",
    category: "other",
    rackUnits: 1,
    ports: [
      ...stereo("Main In", "input", "line", "trs"),
      ...channels(4, "Phones Out", "output", "line", "trs"),
    ],
  },
];

/* ── Resolver ───────────────────────────────────────────────── */

/**
 * The ports a device should get. Exact template when we have one,
 * category fallback otherwise, and an empty-but-valid list as the
 * last resort so placing a device never fails outright.
 */
export function portsFor(catalogId: string | undefined, category: string): PortTemplate[] {
  if (catalogId && CATALOG_PORTS[catalogId]) return CATALOG_PORTS[catalogId];
  const fallback = CATEGORY_DEFAULTS[category];
  return fallback ? fallback() : CATEGORY_DEFAULTS.other();
}

/** True when a profile should warn about phantom power reaching it. */
export function isPhantomSensitive(catalogId: string | undefined, name: string): boolean {
  if (catalogId && PHANTOM_SENSITIVE.has(catalogId)) return true;
  // Anything that calls itself a ribbon gets the same protection.
  return /\bribbon\b/i.test(name);
}

/** Count of ports by direction, used by the device list and palette. */
export function portCounts(ports: PortTemplate[]): { inputs: number; outputs: number } {
  let inputs = 0;
  let outputs = 0;
  for (const p of ports) {
    if (p.direction === "input" || p.direction === "bidirectional") inputs++;
    if (p.direction === "output" || p.direction === "bidirectional") outputs++;
  }
  return { inputs, outputs };
}
