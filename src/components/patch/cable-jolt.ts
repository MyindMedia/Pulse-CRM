"use client";

/**
 * The kick a cable gets when you let go of a device.
 *
 * Dragging alone is not enough to make a run swing. A slow drag feeds the
 * spring tiny per-frame impulses that the damping eats immediately, so the
 * cable arrives at its new position already at rest and the release looks
 * dead. Real cables do the opposite: the weight you were carrying has to go
 * somewhere the moment your hand stops holding it.
 *
 * So the canvas announces "these devices were just put down, and this is how
 * fast they were travelling", and every run touching one of them takes an
 * impulse. Runs elsewhere on the canvas stay still, which is the whole point
 * of scoping this to node ids rather than jolting everything.
 */

export type CableJolt = {
  /** Bumped on every release so subscribers can tell one drop from the next. */
  seq: number;
  /** Device node ids that were just released. */
  nodes: ReadonlySet<string>;
  /** Flow units per second at the moment of release, per axis. */
  vx: number;
  vy: number;
};

const EMPTY: CableJolt = { seq: 0, nodes: new Set(), vx: 0, vy: 0 };

let current: CableJolt = EMPTY;
const listeners = new Set<() => void>();

export function subscribeCableJolt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCableJolt() {
  return current;
}

/** Server render has never seen a drag. */
export function readCableJoltServer() {
  return EMPTY;
}

export function announceCableJolt(nodes: Iterable<string>, vx: number, vy: number) {
  current = { seq: current.seq + 1, nodes: new Set(nodes), vx, vy };
  for (const listener of listeners) listener();
}
