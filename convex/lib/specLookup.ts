import { CONNECTOR_DEFS, type ConnectorValue } from "./connectors";
import {
  port,
  CATEGORY_DEFAULTS,
  type PortTemplate,
  type PortDirection,
  type SignalLevel,
  type PortCapability,
} from "./portTemplates";

/* ============================================================
   Turning a described device into ports we are willing to trust.

   A language model is a good way to remember that a Scarlett
   18i20 has eight preamps and an ADAT pair. It is a terrible
   source of truth, because it will happily invent a connector
   that does not exist and a signal level we have no word for.

   So nothing it says reaches the database unchecked. Every port
   is validated against the same vocabulary the connector-mating
   engine uses, anything unrecognised is dropped rather than
   coerced, and a device that comes back mostly garbage falls
   through to the category default instead of shipping nonsense
   that will fail at 2am behind a rack.
   ============================================================ */

/** The shape we ask the model for. Deliberately small and flat. */
export type SpecCandidate = {
  confident?: boolean;
  summary?: string;
  ports?: {
    label?: string;
    direction?: string;
    signalLevel?: string;
    connector?: string;
    /** A bank of identical jacks, expanded to numbered rows. */
    count?: number;
    capabilities?: string[];
  }[];
};

export type SpecResolution = {
  ports: PortTemplate[];
  source: "ai" | "category";
  summary?: string;
  /** How many ports the model proposed that we refused to accept. */
  rejected: number;
};

const DIRECTIONS = new Set<PortDirection>(["input", "output", "bidirectional"]);
const LEVELS = new Set<SignalLevel>([
  "mic",
  "line",
  "instrument",
  "speaker",
  "digital",
  "control",
]);
const CAPABILITIES = new Set<PortCapability>([
  "phantom",
  "pad",
  "polarity",
  "monoSum",
  "hpf",
  "impedance",
]);

/** Ports beyond this on one device are almost certainly a runaway bank. */
const MAX_PORTS = 96;
/** A single `count` this large means the model lost the plot. */
const MAX_BANK = 64;

/**
 * Common ways a model names a connector, mapped onto our vocabulary.
 * Kept deliberately short: this is for spelling, not for guessing. A
 * connector we cannot name is a port we drop.
 */
const CONNECTOR_ALIASES: Record<string, ConnectorValue> = {
  xlr: "xlr3",
  "xlr-3": "xlr3",
  xlr3pin: "xlr3",
  "xlr 3-pin": "xlr3",
  "xlr-5": "xlr5",
  jack: "trs",
  "1/4": "trs",
  "1/4 trs": "trs",
  "quarter inch": "trs",
  "1/4 ts": "ts",
  "3.5mm": "trs_mini",
  minijack: "trs_mini",
  "1/8": "trs_mini",
  tt: "bantam",
  "tt bantam": "bantam",
  "db-25": "db25",
  dsub: "db25",
  "d-sub": "db25",
  "usb-a": "usb_a",
  usba: "usb_a",
  "usb-b": "usb_b",
  usbb: "usb_b",
  "usb-c": "usb_c",
  usbc: "usb_c",
  "usb type-c": "usb_c",
  "usb mini": "usb_b_mini",
  "usb micro": "usb_b_micro",
  tb: "thunderbolt",
  "thunderbolt 3": "thunderbolt",
  "thunderbolt 4": "thunderbolt",
  ethernet: "rj45",
  midi: "midi_din",
  din: "midi_din",
  adat: "adat_optical",
  toslink: "spdif_optical",
  "optical spdif": "spdif_optical",
  "coax spdif": "spdif_coax",
  "word clock": "wordclock_bnc",
  wordclock: "wordclock_bnc",
  phono: "rca",
};

/*
 * The pre-split catch-alls. They still exist so old rows keep working, and
 * they mate with anything in their family - which is exactly why a fresh
 * lookup must never mint one. "xlr" would silently disable the gender check
 * on a jack we could have named precisely.
 */
const LEGACY_CONNECTORS = new Set(["xlr", "usb", "other"]);

/** Resolve a model's spelling to a connector we actually understand. */
export function normaliseConnector(raw: string | undefined): ConnectorValue | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  // Aliases are consulted first so "xlr" lands on the specific xlr3 rather
  // than matching the legacy wildcard that shares its name.
  const alias = CONNECTOR_ALIASES[key];
  if (alias) return alias;
  if (LEGACY_CONNECTORS.has(key)) return null;
  if (key in CONNECTOR_DEFS) return key as ConnectorValue;
  const underscored = key.replace(/[\s-]+/g, "_");
  if (LEGACY_CONNECTORS.has(underscored)) return null;
  if (underscored in CONNECTOR_DEFS) return underscored as ConnectorValue;
  return null;
}

function normaliseDirection(raw: string | undefined): PortDirection | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (DIRECTIONS.has(key as PortDirection)) return key as PortDirection;
  if (key === "in") return "input";
  if (key === "out") return "output";
  if (key === "io" || key === "i/o" || key === "both") return "bidirectional";
  return null;
}

function normaliseLevel(raw: string | undefined): SignalLevel | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (LEVELS.has(key as SignalLevel)) return key as SignalLevel;
  if (key === "inst" || key === "hi-z" || key === "hiz") return "instrument";
  if (key === "monitor" || key === "speaker level") return "speaker";
  if (key === "clock" || key === "midi") return "control";
  if (key === "aes" || key === "spdif" || key === "adat") return "digital";
  return null;
}

/**
 * Validate a proposed spec into ports, or refuse it.
 *
 * Returns the category default when too little survives, because a device
 * with two plausible ports out of a claimed twenty is worse than an honest
 * generic template: it looks specific and is wrong.
 */
export function resolveSpec(
  candidate: SpecCandidate | null | undefined,
  category: string,
): SpecResolution {
  const fallback = (): SpecResolution => ({
    ports: (CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.other)(),
    source: "category",
    rejected: 0,
  });

  if (!candidate?.ports?.length) return fallback();

  const ports: PortTemplate[] = [];
  let rejected = 0;

  for (const raw of candidate.ports) {
    const direction = normaliseDirection(raw.direction);
    const signalLevel = normaliseLevel(raw.signalLevel);
    const connector = normaliseConnector(raw.connector);
    const label = (raw.label ?? "").trim();

    // Every one of these is load-bearing for the connector checks and the
    // run list. A port missing any of them cannot be validated later, so it
    // does not get in.
    if (!direction || !signalLevel || !connector || !label) {
      rejected += 1;
      continue;
    }

    const capabilities = (raw.capabilities ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter((c): c is PortCapability => CAPABILITIES.has(c as PortCapability));

    const count = Number.isFinite(raw.count) ? Math.floor(raw.count as number) : 1;
    if (count < 1 || count > MAX_BANK) {
      rejected += 1;
      continue;
    }

    if (count === 1) {
      ports.push(port(label, direction, signalLevel, connector, capabilities));
    } else {
      // A bank becomes numbered rows, because a DB25 snake is eight ports
      // here and never one. Channel index is what lets the canvas lay a
      // patchbay out in order.
      for (let i = 1; i <= count; i += 1) {
        ports.push(
          port(`${label} ${i}`, direction, signalLevel, connector, capabilities, i),
        );
      }
    }

    if (ports.length > MAX_PORTS) break;
  }

  if (ports.length === 0) return fallback();

  // Mostly-rejected means the model was guessing at a device it does not
  // know. Half-remembered I/O is the failure mode worth refusing outright.
  if (rejected > ports.length) return { ...fallback(), rejected };

  return {
    ports: ports.slice(0, MAX_PORTS),
    source: "ai",
    summary: candidate.summary?.trim() || undefined,
    rejected,
  };
}

/** The prompt. Kept here so the vocabulary and the ask cannot drift apart. */
export function specPrompt(input: {
  name: string;
  manufacturer?: string;
  category: string;
  note?: string;
}): string {
  const connectors = Object.keys(CONNECTOR_DEFS)
    .filter((c) => c !== "xlr" && c !== "usb" && c !== "other")
    .join(", ");
  return [
    `Device: ${[input.manufacturer, input.name].filter(Boolean).join(" ")}`,
    `Category: ${input.category}`,
    input.note ? `Known detail: ${input.note}` : "",
    "",
    "List the physical audio and data connectors on this device's chassis:",
    "the jacks an engineer could actually plug a cable into. One entry per",
    "distinct jack type, using `count` for a bank of identical jacks (eight",
    "mic inputs is one entry with count 8, not eight entries).",
    "",
    `connector must be one of: ${connectors}`,
    "direction must be one of: input, output, bidirectional",
    "signalLevel must be one of: mic, line, instrument, speaker, digital, control",
    "capabilities may include: phantom, pad, polarity, monoSum, hpf, impedance",
    "",
    "Omit power inlets, and omit anything you are not sure about rather than",
    "guessing. Set confident to false if you do not know this specific model.",
    "Give summary as one short line an engineer would recognise, such as",
    '"8 mic pres, 18 in / 20 out over USB-C".',
  ]
    .filter(Boolean)
    .join("\n");
}

/** JSON schema handed to the model, so the response arrives already shaped. */
export const SPEC_SCHEMA = {
  name: "device_io",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["confident", "summary", "ports"],
    properties: {
      confident: { type: "boolean" },
      summary: { type: "string" },
      ports: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "direction", "signalLevel", "connector", "count", "capabilities"],
          properties: {
            label: { type: "string" },
            direction: { type: "string" },
            signalLevel: { type: "string" },
            connector: { type: "string" },
            count: { type: "integer" },
            capabilities: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
} as const;
