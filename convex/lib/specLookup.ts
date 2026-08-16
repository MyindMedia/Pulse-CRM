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

/** A word the vocabulary does not know yet, kept so it can be added. */
export type VocabGap = {
  kind: "connector" | "signalLevel" | "direction";
  term: string;
  /** The port it appeared on, for context when reviewing. */
  onPort: string;
};

export type SpecResolution = {
  ports: PortTemplate[];
  source: "ai" | "category";
  summary?: string;
  /** How many ports the model proposed that we refused to accept. */
  rejected: number;
  /*
   * Everything we could not place. Dropping a jack silently is how a
   * vocabulary stops growing: nobody ever finds out that "EtherCON" or
   * "Euroblock" turned up nine times last month. These are recorded so the
   * gap becomes a list someone can act on.
   */
  gaps: VocabGap[];
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
  "1/4\" trs": "trs",
  '"1/4" jack"': "trs",
  "quarter inch": "trs",
  "1/4 ts": "ts",
  "1/4\" ts": "ts",
  "trs jack": "trs",
  "ts jack": "ts",
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

/*
 * Models write panel labels the way a manual prints them: "USB\u2011C" with a
 * non-breaking hyphen, \u00bc" with a fraction glyph, curly quotes. Those are
 * the same connector as the ASCII spelling and must not be dropped over
 * typography, so the text is flattened before anything is matched.
 */
function flatten(raw: string): string {
  return raw
    .normalize("NFKD")
    // Every dash-like character becomes a plain hyphen.
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Resolve a model's spelling to a connector we actually understand. */
export function normaliseConnector(raw: string | undefined): ConnectorValue | null {
  if (!raw) return null;
  const key = flatten(raw);

  /*
   * A combo jack is one hole that takes an XLR or a jack plug. Our
   * vocabulary has no "accepts either", and an interface's mic inputs are
   * overwhelmingly used as XLR, so a combo is recorded as XLR rather than
   * dropped. That is a deliberate simplification: a TRS run into a combo
   * will read as a mismatch and want the port corrected by hand.
   */
  if (/combo/.test(key) && /xlr/.test(key)) return "xlr3";
  // Aliases are consulted first so "xlr" lands on the specific xlr3 rather
  // than matching the legacy wildcard that shares its name.
  const alias = CONNECTOR_ALIASES[key];
  if (alias) return alias;
  if (LEGACY_CONNECTORS.has(key)) return null;
  if (key in CONNECTOR_DEFS) return key as ConnectorValue;
  const underscored = key.replace(/[\s-]+/g, "_");
  if (LEGACY_CONNECTORS.has(underscored)) return null;
  if (underscored in CONNECTOR_DEFS) return underscored as ConnectorValue;

  return matchConnectorPhrase(key);
}

/*
 * Documentation does not name connectors the way an enum does. A manual
 * says "Analog input, balanced XLR female" or "two RJ45 connectors for
 * GLM", and refusing those loses the whole point of reading the manual.
 *
 * Ordered most specific first, because "usb-c" contains "usb" and "xlr5"
 * contains "xlr": a shorter pattern matching first would quietly downgrade
 * a jack we could have named exactly.
 */
const CONNECTOR_PHRASES: [RegExp, ConnectorValue][] = [
  [/\bmini[\s-]?xlr\b|\bta[34]\b/, "mini_xlr"],
  [/\b4[\s-]?pin\b.*\bxlr\b|\bxlr[\s-]?4\b/, "xlr4"],
  [/\b5[\s-]?pin\b.*\bxlr\b|\bxlr[\s-]?5\b/, "xlr5"],
  [/\beuroblock\b|\bphoenix\b|\bterminal block\b|\bscrew terminal\b/, "euroblock"],
  [/\btrrs\b|\bheadset jack\b/, "trrs"],
  [/\bethercon\b/, "rj45"],
  [/\bxlr\b/, "xlr3"],
  [/\bthunderbolt\b|\btb[34]\b/, "thunderbolt"],
  [/\busb[\s-]?c\b|\busb type[\s-]?c\b/, "usb_c"],
  [/\busb\b.*\bmicro\b|\bmicro[\s-]?usb\b/, "usb_b_micro"],
  [/\busb\b.*\bmini\b|\bmini[\s-]?usb\b/, "usb_b_mini"],
  [/\busb[\s-]?b\b|\busb type[\s-]?b\b|\busb printer\b/, "usb_b"],
  [/\busb[\s-]?a\b|\busb type[\s-]?a\b/, "usb_a"],
  [/\bword\s?clock\b/, "wordclock_bnc"],
  [/\badat\b|\blightpipe\b/, "adat_optical"],
  [/\btoslink\b|\boptical\b/, "spdif_optical"],
  [/\bs\/?pdif\b.*\bcoax|\bcoax.*\bs\/?pdif\b|\bs\/?pdif\b/, "spdif_coax"],
  [/\bbnc\b/, "bnc"],
  [/\bdb[\s-]?25\b|\bd[\s-]?sub\b|\bd25\b/, "db25"],
  [/\bspeakon\b|\bnl[24]\b/, "speakon"],
  [/\bbanana\b|\bbinding post\b/, "banana"],
  [/\brca\b|\bphono\b|\bcinch\b/, "rca"],
  [/\brj[\s-]?45\b|\bethernet\b|\bnetwork\b|\bcat[56]\b/, "rj45"],
  [/\bmidi\b|\b5[\s-]?pin din\b|\bdin\b/, "midi_din"],
  [/\bbantam\b|\btt\b/, "bantam"],
  [/\b3\.5\s?mm\b|\b1\/8\b|\bmini[\s-]?jack\b|\beighth\b/, "trs_mini"],
  [/\bts\b|\bunbalanced\b.*\bjack\b/, "ts"],
  [/\btrs\b|\b1\/4\b|\bquarter\b|\bjack\b|\bphone plug\b/, "trs"],
];

/*
 * Power inlets are not signal connectors. A manual lists them alongside the
 * audio I/O and a model will happily hand them over, so they are named here
 * and refused outright rather than being left to fall through to something
 * that merely looks close.
 */
const NOT_A_SIGNAL_CONNECTOR =
  /\biec\b|\bmains\b|\bpower\b|\bdc\b|\bbarrel\b|\bpsu\b|\bkettle\b|\bearth\b|\bground\b/;

/** True when we refused on purpose, so it is not a vocabulary gap. */
export function isDeliberateRefusal(raw: string): boolean {
  return NOT_A_SIGNAL_CONNECTOR.test(flatten(raw));
}

/** Read a connector out of a sentence, or refuse. */
export function matchConnectorPhrase(flattened: string): ConnectorValue | null {
  if (NOT_A_SIGNAL_CONNECTOR.test(flattened)) return null;
  for (const [pattern, value] of CONNECTOR_PHRASES) {
    if (pattern.test(flattened)) return value;
  }
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
  const key = flatten(raw);
  if (LEVELS.has(key as SignalLevel)) return key as SignalLevel;
  if (/\binst|hi-?z\b|guitar|\bdi\b/.test(key)) return "instrument";
  if (/monitor|speaker|amplifier/.test(key)) return "speaker";
  if (/clock|midi|\bctrl\b|control|network|remote/.test(key)) return "control";
  if (/aes|s\/?pdif|adat|digital|optical|usb|dante|madi/.test(key)) return "digital";
  if (/\bmic\b|microphone/.test(key)) return "mic";
  /*
   * "Analog" is how a manual says "not digital", and it is by far the most
   * common level word in real documentation. Line is the right reading of it
   * on everything except a mic input, which is caught above.
   */
  if (/analog|analogue|balanced|unbalanced|\bline\b|\baux\b/.test(key)) return "line";
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
  const gaps: VocabGap[] = [];
  const fallback = (): SpecResolution => ({
    ports: (CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.other)(),
    source: "category",
    rejected: 0,
    gaps,
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
      // Record WHICH word we could not place, not just that we failed. A
      // power inlet is a deliberate refusal and not a gap, so anything the
      // refusal list already covers is left out.
      const where = label || "(unlabelled)";
      /*
       * A power inlet is refused on purpose, so nothing about it is a gap.
       * Recording its level as missing vocabulary would fill the review
       * queue with "AC" and "mains" and bury the terms worth acting on.
       */
      const deliberate =
        (raw.connector && isDeliberateRefusal(raw.connector)) ||
        (label && isDeliberateRefusal(label));

      if (!deliberate) {
        if (raw.connector && !connector) {
          gaps.push({ kind: "connector", term: raw.connector.trim(), onPort: where });
        }
        if (raw.signalLevel && !signalLevel) {
          gaps.push({ kind: "signalLevel", term: raw.signalLevel.trim(), onPort: where });
        }
        if (raw.direction && !direction) {
          gaps.push({ kind: "direction", term: raw.direction.trim(), onPort: where });
        }
      }
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
    gaps,
  };
}

/**
 * The product name to ask about.
 *
 * A profile's name usually already carries the brand, so joining the two
 * blindly produces "Genelec Genelec 8351B" - which is not a product, and a
 * model asked about it will decline to be confident rather than answer.
 * That one duplicated word was enough to make lookups fail.
 */
export function deviceName(manufacturer: string | undefined, name: string): string {
  const brand = manufacturer?.trim();
  if (!brand) return name.trim();
  const alreadyThere = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return alreadyThere.test(name) ? name.trim() : `${brand} ${name}`.trim();
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
    `Device: ${deviceName(input.manufacturer, input.name)}`,
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

/* ============================================================
   Comparing a spec sheet against the jacks a device already has.

   The point of showing a diff rather than replacing the port
   list is that a port can have a cable in it. Destroying one
   silently un-patches a run someone documented, so every removal
   has to be visible and refusable before anything is written.
   ============================================================ */

export type ExistingPort = {
  _id: string;
  label: string;
  direction: PortDirection;
  signalLevel: string;
  connector: string;
  /** How many cables are currently patched into this jack. */
  patched: number;
};

export type PortDiff = {
  add: PortTemplate[];
  keep: { port: ExistingPort; matches: PortTemplate }[];
  remove: ExistingPort[];
};

/** Labels differ by punctuation and case far more often than by meaning. */
function labelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Line a proposed port list up against the jacks already on a device.
 *
 * Matching is by label and direction, because that is what a person reads
 * off a panel. A jack whose connector was guessed wrong still matches its
 * proposal - it is the same hole, and the diff should offer to correct it
 * rather than to delete and recreate it, which would pull its cable.
 */
export function diffPorts(existing: ExistingPort[], proposed: PortTemplate[]): PortDiff {
  const unclaimed = new Map<string, ExistingPort[]>();
  for (const port of existing) {
    const key = `${labelKey(port.label)}|${port.direction}`;
    const list = unclaimed.get(key) ?? [];
    list.push(port);
    unclaimed.set(key, list);
  }

  const add: PortTemplate[] = [];
  const keep: { port: ExistingPort; matches: PortTemplate }[] = [];

  for (const candidate of proposed) {
    const key = `${labelKey(candidate.label)}|${candidate.direction}`;
    const pool = unclaimed.get(key);
    const match = pool?.shift();
    if (match) keep.push({ port: match, matches: candidate });
    else add.push(candidate);
  }

  const remove = [...unclaimed.values()].flat();
  return { add, keep, remove };
}
