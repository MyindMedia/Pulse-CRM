import type { LucideIcon } from "lucide-react";

/* ============================================================
   Dynamic Island notifications - the model behind
   src/components/shell/dynamic-island.tsx.

   A port of rit3zh/expo-dynamic-notifications to the web: a black
   pill at the top of the screen lets a drop fall out of it, joined
   by a gooey neck, and the drop grows into a capsule card below.
   Everything here is pure (geometry and a tiny store) so the shape
   maths and the queue can be tested without a browser.
   ============================================================ */

export type IslandTone = "gold" | "positive" | "critical" | "info" | "neutral";

export type IslandNotice = {
  /** Pass one to update or dismiss this notice later. */
  id?: string;
  title: string;
  message?: string;
  icon?: LucideIcon;
  /** Small picture on the left instead of the icon (a receipt, an avatar). */
  image?: string;
  tone?: IslandTone;
  /** Spinner in the icon slot; the notice stays until updated or dismissed. */
  loading?: boolean;
  /** Milliseconds on screen once revealed. null keeps it until dismissed. */
  duration?: number | null;
  /** Tapping the card runs this, then dismisses it. */
  onPress?: () => void;
  /** Short hint on the right, e.g. "View". */
  actionLabel?: string;
};

export type ActiveNotice = IslandNotice & { id: string };

export const DEFAULT_DURATION = 3600;

// ── Geometry ────────────────────────────────────────────────────────────────

export const ISLAND = { width: 126, height: 37.33 } as const;
export const CARD = { height: 74, gap: 34, maxWidth: 396 } as const;

export type IslandLayout = {
  width: number;
  centerX: number;
  islandTop: number;
  islandBottom: number;
  cardWidth: number;
  cardTop: number;
  cardCenterY: number;
  cardRadius: number;
};

/** Where the island and card sit for a viewport. With a notch (safe area
 *  inset on an iPhone) the pill lines up with the hardware island. */
export function islandLayout(viewportWidth: number, safeTop: number): IslandLayout {
  const islandTop = safeTop > 0 ? Math.max(safeTop - ISLAND.height - 11, 12) : 12;
  const islandBottom = islandTop + ISLAND.height;
  const cardTop = islandBottom + CARD.gap;
  return {
    width: viewportWidth,
    centerX: viewportWidth / 2,
    islandTop,
    islandBottom,
    cardWidth: Math.max(0, Math.min(viewportWidth - 32, CARD.maxWidth)),
    cardTop,
    cardCenterY: cardTop + CARD.height / 2,
    cardRadius: CARD.height / 2,
  };
}

export const mix = (p: number, a: number, b: number) => a + (b - a) * p;
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const easeOutPower = (p: number, k: number) => 1 - Math.pow(1 - clamp(p, 0, 1), k);

/** 0 at both ends, 1 at its peak: how thick the neck between island and drop is. */
export function neckProfile(p: number, rise: number, fall: number) {
  const t = clamp(p, 0, 1);
  if (t <= 0 || t >= 1) return 0;
  const peak = rise / (rise + fall);
  const norm = Math.pow(peak, rise) * Math.pow(1 - peak, fall);
  return (Math.pow(t, rise) * Math.pow(1 - t, fall)) / norm;
}

export type IslandGeometry = {
  x: number; y: number; width: number; height: number; radius: number;
  neckX: number; neckY: number; neckWidth: number; neckHeight: number; neckRadius: number;
  /** How far the card's centre is from where it finally rests. */
  offsetY: number;
  widthRatio: number;
};

/** The drop, neck and card shape for `drop` (falling) and `expand` (growing
 *  into the card), both 0..1 and allowed to overshoot on a spring. */
export function islandGeometry(drop: number, expand: number, L: IslandLayout): IslandGeometry {
  const grow = easeOutPower(clamp(drop / 0.7, 0, 1), 1.25);
  const neck = neckProfile(drop / 0.82, 1.6, 1.4);
  const stretch = 1 + 0.38 * neck;
  const droplet = 52 * grow;
  const width = Math.max(0, Math.min(mix(expand, droplet / stretch, L.cardWidth), L.width - 20));
  const height = Math.max(0, mix(expand, droplet * stretch, CARD.height));
  const radius = Math.max(0, Math.min(mix(expand, droplet * 0.5, L.cardRadius), Math.min(width, height) / 2));
  const originY = L.islandBottom - ISLAND.height * 0.34;
  const centerY = mix(drop, originY, L.cardCenterY);
  const neckWidth = Math.min(60, width) * neck;
  const neckY = L.islandBottom - ISLAND.height * 0.5;
  return {
    x: L.centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    radius,
    neckX: L.centerX - neckWidth / 2,
    neckY,
    neckWidth,
    neckHeight: Math.max(centerY - neckY, 0),
    neckRadius: neckWidth / 2,
    offsetY: centerY - L.cardCenterY,
    widthRatio: L.cardWidth > 0 ? width / L.cardWidth : 1,
  };
}

/** Linear blend of two #rrggbb colours. */
export function mixHex(a: string, b: string, p: number) {
  const t = clamp(p, 0, 1);
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(mix(t, (pa >> shift) & 255, (pb >> shift) & 255));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

// ── Store ───────────────────────────────────────────────────────────────────

type Listener = () => void;

const MAX_QUEUED = 6;

/** The queue of notices. The first item is the one on screen (or about to
 *  be); the host component animates it in and out. */
export function createIslandStore() {
  let items: ActiveNotice[] = [];
  let hosts = 0;
  let seq = 0;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => items,
    /** Whether a host is mounted to draw notices at all. */
    hasHost: () => hosts > 0,
    attachHost() {
      hosts += 1;
      return () => { hosts -= 1; };
    },
    show(notice: IslandNotice): string {
      const id = notice.id ?? `island-${++seq}`;
      const next = { ...notice, id };
      if (items.some((n) => n.id === id)) {
        items = items.map((n) => (n.id === id ? next : n));
      } else {
        // A burst never builds an endless backlog: keep the one on screen and
        // the newest few behind it.
        items = [...items, next];
        if (items.length > MAX_QUEUED) items = [items[0], ...items.slice(-(MAX_QUEUED - 1))];
      }
      emit();
      return id;
    },
    /** Change a notice in place - the card morphs rather than re-dropping. */
    update(id: string, patch: Partial<IslandNotice>) {
      if (!items.some((n) => n.id === id)) return false;
      items = items.map((n) => (n.id === id ? { ...n, ...patch, id } : n));
      emit();
      return true;
    },
    dismiss(id?: string) {
      const before = items.length;
      items = id === undefined ? items.slice(1) : items.filter((n) => n.id !== id);
      if (items.length !== before) emit();
    },
    clear() {
      items = [];
      emit();
    },
  };
}

export type IslandStore = ReturnType<typeof createIslandStore>;
