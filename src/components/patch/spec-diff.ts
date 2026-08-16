import type { PatchPort } from "./device-node";

/* The same comparison the server does, run in the browser so the diff can
   be shown before anything is written. Kept as its own file, and pure, so
   the rule that decides what counts as "the same jack" lives in one place
   and can be tested without a canvas. */

export type ProposedPort = {
  label: string;
  direction: "input" | "output" | "bidirectional";
  signalLevel: string;
  connector: string;
  gender?: string;
  channelIndex?: number;
  capabilities: string[];
};

export type ExistingPortView = {
  _id: string;
  label: string;
  direction: string;
  /** How many cables are patched into this jack right now. */
  patched: number;
};

/** Labels differ by punctuation and case far more often than by meaning. */
function labelKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Line a proposed port list up against the jacks a device already has.
 *
 * Matched by label and direction, because that is what a person reads off a
 * panel. A jack whose connector was guessed wrong still matches its
 * proposal: it is the same hole, so the diff offers to keep it rather than
 * to delete and recreate it, which would pull its cable for nothing.
 */
export function diffPortsClient(
  existing: (PatchPort & { patchedCount?: number })[],
  proposed: ProposedPort[],
) {
  const unclaimed = new Map<string, ExistingPortView[]>();
  for (const port of existing) {
    const key = `${labelKey(port.label)}|${port.direction}`;
    const list = unclaimed.get(key) ?? [];
    list.push({
      _id: port._id,
      label: port.label,
      direction: port.direction,
      patched: port.patchedCount ?? 0,
    });
    unclaimed.set(key, list);
  }

  const add: ProposedPort[] = [];
  const keep: { port: ExistingPortView; matches: ProposedPort }[] = [];

  for (const candidate of proposed) {
    const key = `${labelKey(candidate.label)}|${candidate.direction}`;
    const pool = unclaimed.get(key);
    const match = pool?.shift();
    if (match) keep.push({ port: match, matches: candidate });
    else add.push(candidate);
  }

  return { add, keep, remove: [...unclaimed.values()].flat() };
}
