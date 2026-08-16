/* ============================================================
   CONNECTORS

   What physically plugs into what.

   A patch map that lets you record a USB-C cable going into an
   XLR socket is not documentation, it is fiction. This is the
   table that stops that, and it has to know three things:

   1. The connector type, at real granularity. "USB" is not a
      connector; USB-A, USB-B and USB-C are three incompatible
      plugs that happen to carry the same protocol.
   2. Gender. Two male XLRs do not mate no matter how correct
      the type is.
   3. What genuinely cross-mates. Thunderbolt 3 and 4 use the
      USB-C plug, S/PDIF coax uses an RCA plug, and a TS plug
      physically seats in a TRS socket.

   Everything here is about the metal. Whether the signal makes
   sense once connected is a separate question, handled by the
   level checks.
   ============================================================ */

export type Gender = "male" | "female" | "unspecified";

export type ConnectorValue =
  | "xlr3"
  | "xlr5"
  | "trs"
  | "ts"
  | "trs_mini"
  | "bantam"
  | "db25"
  | "speakon"
  | "banana"
  | "rca"
  | "bnc"
  | "midi_din"
  | "rj45"
  | "usb_a"
  | "usb_b"
  | "usb_b_mini"
  | "usb_b_micro"
  | "usb_c"
  | "thunderbolt"
  | "adat_optical"
  | "spdif_coax"
  | "spdif_optical"
  | "wordclock_bnc"
  // Added because real documentation kept using them: a 4-pin XLR on
  // intercom and some lamp circuits, a mini-XLR on lavalier and compact
  // gear, a Euroblock across install AV, and TRRS on anything that expects
  // a phone headset.
  | "xlr4"
  | "mini_xlr"
  | "euroblock"
  | "trrs"
  // Legacy values from before the vocabulary was split out. Kept so old
  // rows keep working, and treated as "any variant of this family" so
  // they warn rather than block.
  | "xlr"
  | "usb"
  | "other";

type ConnectorDef = {
  label: string;
  short: string;
  /** Human grouping for the picker. */
  group: string;
  /** Whether the plug has a gender worth checking. */
  gendered: boolean;
  /** Other connectors this physically mates with, beyond itself. */
  crossMates?: ConnectorValue[];
  /** A vague legacy value that stands in for a whole family. */
  wildcardFor?: ConnectorValue[];
};

export const CONNECTOR_DEFS: Record<ConnectorValue, ConnectorDef> = {
  xlr3: { label: "XLR 3-pin", short: "XLR", group: "Analogue audio", gendered: true },
  xlr5: { label: "XLR 5-pin", short: "XLR5", group: "Analogue audio", gendered: true },
  trs: { label: 'TRS 1/4"', short: "TRS", group: "Analogue audio", gendered: true, crossMates: ["ts"] },
  ts: { label: 'TS 1/4"', short: "TS", group: "Analogue audio", gendered: true, crossMates: ["trs"] },
  trs_mini: { label: "TRS 3.5mm", short: "3.5", group: "Analogue audio", gendered: true },
  bantam: { label: "Bantam / TT", short: "TT", group: "Analogue audio", gendered: true },
  db25: { label: "DB25", short: "DB25", group: "Multicore", gendered: true },
  speakon: { label: "SpeakOn", short: "SPK", group: "Speaker", gendered: true },
  banana: { label: "Banana", short: "BAN", group: "Speaker", gendered: true },
  rca: {
    label: "RCA",
    short: "RCA",
    group: "Analogue audio",
    gendered: true,
    crossMates: ["spdif_coax"],
  },
  bnc: { label: "BNC", short: "BNC", group: "Clock and data", gendered: true, crossMates: ["wordclock_bnc"] },
  wordclock_bnc: {
    label: "Word clock (BNC)",
    short: "WCLK",
    group: "Clock and data",
    gendered: true,
    crossMates: ["bnc"],
  },
  xlr4: {
    label: "XLR 4-pin",
    short: "XLR4",
    group: "Analogue",
    gendered: true,
  },
  mini_xlr: {
    label: "Mini XLR (TA3/TA4)",
    short: "miniXLR",
    group: "Analogue",
    gendered: true,
  },
  euroblock: {
    label: "Euroblock / Phoenix",
    short: "EURO",
    group: "Analogue",
    // A screw terminal has no plug gender worth checking.
    gendered: false,
  },
  trrs: {
    label: "3.5mm TRRS",
    short: "TRRS",
    group: "Analogue",
    gendered: false,
    // A TRRS headset plug goes into a TRS socket and passes audio; it is a
    // real-world fit, just not the full story, so it mates rather than
    // matching exactly.
    crossMates: ["trs_mini"],
  },
  midi_din: { label: "MIDI 5-pin DIN", short: "MIDI", group: "Control", gendered: true },
  rj45: { label: "RJ45 / etherCON", short: "RJ45", group: "Clock and data", gendered: true },

  usb_a: { label: "USB-A", short: "USB-A", group: "USB", gendered: true },
  usb_b: { label: "USB-B", short: "USB-B", group: "USB", gendered: true },
  usb_b_mini: { label: "USB Mini-B", short: "MINI-B", group: "USB", gendered: true },
  usb_b_micro: { label: "USB Micro-B", short: "MICRO-B", group: "USB", gendered: true },
  usb_c: {
    label: "USB-C",
    short: "USB-C",
    group: "USB",
    gendered: true,
    // Thunderbolt 3 and 4 use the USB-C plug, so they seat in each other.
    crossMates: ["thunderbolt"],
  },
  thunderbolt: {
    label: "Thunderbolt (USB-C)",
    short: "TB",
    group: "USB",
    gendered: true,
    crossMates: ["usb_c"],
  },

  adat_optical: { label: "ADAT optical (TOSLINK)", short: "ADAT", group: "Digital audio", gendered: true, crossMates: ["spdif_optical"] },
  spdif_optical: { label: "S/PDIF optical (TOSLINK)", short: "OPT", group: "Digital audio", gendered: true, crossMates: ["adat_optical"] },
  spdif_coax: {
    label: "S/PDIF coax (RCA)",
    short: "SPDIF",
    group: "Digital audio",
    gendered: true,
    crossMates: ["rca"],
  },

  // Legacy
  xlr: {
    label: "XLR (unspecified pins)",
    short: "XLR",
    group: "Legacy",
    gendered: true,
    wildcardFor: ["xlr3", "xlr5"],
  },
  usb: {
    label: "USB (unspecified type)",
    short: "USB",
    group: "Legacy",
    gendered: true,
    wildcardFor: ["usb_a", "usb_b", "usb_b_mini", "usb_b_micro", "usb_c", "thunderbolt"],
  },
  other: { label: "Other", short: "OTH", group: "Legacy", gendered: false },
};

export const CONNECTOR_VALUES = Object.keys(CONNECTOR_DEFS) as ConnectorValue[];

export function connectorDef(value: string): ConnectorDef {
  return (
    CONNECTOR_DEFS[value as ConnectorValue] ?? {
      label: value,
      short: value.toUpperCase().slice(0, 5),
      group: "Legacy",
      gendered: false,
    }
  );
}

export type MateVerdict = "exact" | "compatible" | "vague" | "mismatch";

export type MateResult = {
  verdict: MateVerdict;
  /** Plain sentence for a human, only set when it is not an exact match. */
  reason?: string;
};

/**
 * Can this plug seat in that socket?
 *
 * `exact` is the same connector with opposite or unstated gender.
 * `compatible` is a real cross-mate, like Thunderbolt into USB-C.
 * `vague` means one side is a legacy catch-all and we will not guess.
 * `mismatch` is metal that does not fit metal.
 */
export function mate(
  a: string,
  b: string,
  genderA: Gender = "unspecified",
  genderB: Gender = "unspecified",
): MateResult {
  const defA = connectorDef(a);
  const defB = connectorDef(b);

  const genderClash =
    defA.gendered &&
    defB.gendered &&
    genderA !== "unspecified" &&
    genderB !== "unspecified" &&
    genderA === genderB;

  const wildcard =
    (defA.wildcardFor?.includes(b as ConnectorValue) ?? false) ||
    (defB.wildcardFor?.includes(a as ConnectorValue) ?? false) ||
    a === "other" ||
    b === "other";

  if (a === b) {
    if (genderClash) {
      return {
        verdict: "mismatch",
        reason: `Both ends are ${genderA}. ${defA.label} needs one male and one female.`,
      };
    }
    return { verdict: "exact" };
  }

  const crossMates =
    (defA.crossMates?.includes(b as ConnectorValue) ?? false) ||
    (defB.crossMates?.includes(a as ConnectorValue) ?? false);

  if (crossMates) {
    if (genderClash) {
      return {
        verdict: "mismatch",
        reason: `${defA.label} and ${defB.label} mate, but both ends are ${genderA}.`,
      };
    }
    return {
      verdict: "compatible",
      reason: `${defA.label} into ${defB.label}. These mate physically.`,
    };
  }

  if (wildcard) {
    return {
      verdict: "vague",
      reason: `One side is recorded only as ${defA.wildcardFor ? defA.label : defB.label}. Set the exact type to be sure.`,
    };
  }

  return {
    verdict: "mismatch",
    reason: `${defA.label} does not fit ${defB.label}.`,
  };
}

const RANK: Record<MateVerdict, number> = {
  exact: 3,
  compatible: 2,
  vague: 1,
  mismatch: 0,
};

export type CableEnd = { connector: string; gender?: Gender };
export type PortEnd = { connector: string; gender?: Gender; label?: string };

export type CableFit = {
  verdict: MateVerdict;
  /** true when end A goes to the source port, false when it is reversed. */
  aToSource: boolean;
  reasons: string[];
};

/**
 * Does this cable physically join these two ports?
 *
 * A cable has no inherent direction, so both orientations are tried and
 * the better one wins. The verdict is the weaker of the two ends: a cable
 * that fits perfectly at one end and not at all at the other does not fit.
 */
export function cableFit(
  endA: CableEnd,
  endB: CableEnd,
  source: PortEnd,
  target: PortEnd,
): CableFit {
  function score(first: CableEnd, second: CableEnd): { verdict: MateVerdict; reasons: string[] } {
    const one = mate(
      first.connector,
      source.connector,
      first.gender ?? "unspecified",
      source.gender ?? "unspecified",
    );
    const two = mate(
      second.connector,
      target.connector,
      second.gender ?? "unspecified",
      target.gender ?? "unspecified",
    );
    const verdict = RANK[one.verdict] <= RANK[two.verdict] ? one.verdict : two.verdict;
    const reasons: string[] = [];
    if (one.reason) reasons.push(`${source.label ?? "Source"}: ${one.reason}`);
    if (two.reason) reasons.push(`${target.label ?? "Destination"}: ${two.reason}`);
    return { verdict, reasons };
  }

  const forward = score(endA, endB);
  const reversed = score(endB, endA);

  if (RANK[forward.verdict] >= RANK[reversed.verdict]) {
    return { verdict: forward.verdict, aToSource: true, reasons: forward.reasons };
  }
  return { verdict: reversed.verdict, aToSource: false, reasons: reversed.reasons };
}

/** The gender a jack on a device usually has, by convention. */
export function conventionalPortGender(
  connector: string,
  direction: "input" | "output" | "bidirectional",
): Gender {
  // Audio convention: signal flows from a male plug into a female socket,
  // so an output jack presents male pins and an input jack presents female.
  if (connector === "xlr3" || connector === "xlr5" || connector === "xlr") {
    return direction === "output" ? "male" : "female";
  }
  // Everything else on a chassis is a socket, and the cable brings plugs.
  return "female";
}
