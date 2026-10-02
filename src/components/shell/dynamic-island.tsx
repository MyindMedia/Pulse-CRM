"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  frame,
  cancelFrame,
  motion,
  motionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CARD,
  DEFAULT_DURATION,
  ISLAND,
  clamp,
  createIslandStore,
  islandGeometry,
  islandLayout,
  mix,
  mixHex,
  type ActiveNotice,
  type IslandLayout,
  type IslandNotice,
  type IslandTone,
} from "@/lib/dynamic-island";

/* ============================================================
   Dynamic Island notifications.

   A web port of rit3zh/expo-dynamic-notifications. A black pill
   wakes at the top of the screen, a drop falls out of it on a
   gooey neck (an SVG blur + alpha-threshold filter) and grows into
   a capsule card; the text resolves out of a blur. Tap the card to
   act on it, swipe it up to put it away. In the iPhone app the pill
   sits exactly over the hardware island.

     island.show({ title, message, icon, tone, onPress })
     const id = island.show({ title: "Uploading", loading: true });
     island.update(id, { title: "Done", tone: "positive", loading: false });

   Mounted once in the app shell. Outside it (portal, kiosk) the
   same calls fall back to an ordinary toast.
   ============================================================ */

const store = createIslandStore();

const ISLAND_COLOR = "#000000";
const CARD_COLOR = "#fbfbfa";
/** How long a notice stays before a queued one may push it out. */
const MIN_VISIBLE = 1800;

const TONE: Record<IslandTone, { bg: string; fg: string; text: string }> = {
  gold: { bg: "#fdb913", fg: "#241900", text: "#9a6a00" },
  positive: { bg: "#3ddc91", fg: "#04301b", text: "#12804f" },
  critical: { bg: "#ff5d5d", fg: "#ffffff", text: "#c62f2f" },
  info: { bg: "#5db4ff", fg: "#062540", text: "#1f6fb8" },
  neutral: { bg: "#e8e9eb", fg: "#3a3a40", text: "#55565c" },
};

function fallbackToast(id: string, n: Partial<IslandNotice>) {
  if (!n.title) return;
  const opts = {
    id,
    description: n.message,
    duration: n.duration === null ? Infinity : n.duration,
    action: n.onPress ? { label: n.actionLabel ?? "View", onClick: n.onPress } : undefined,
  };
  if (n.loading) toast.loading(n.title, opts);
  else if (n.tone === "critical") toast.error(n.title, opts);
  else if (n.tone === "positive") toast.success(n.title, opts);
  else toast(n.title, opts);
}

let fallbackSeq = 0;

export const island = {
  /** Show a notice; returns its id for update/dismiss. */
  show(notice: IslandNotice): string {
    if (store.hasHost()) return store.show(notice);
    const id = notice.id ?? `island-toast-${++fallbackSeq}`;
    fallbackToast(id, notice);
    return id;
  },
  /** Morph a notice that is showing or queued. */
  update(id: string, patch: Partial<IslandNotice>) {
    if (store.update(id, patch)) return;
    if (!store.hasHost()) {
      fallbackToast(id, patch);
    } else if (patch.title && !patch.loading) {
      // Swiped away while it was still working: the outcome still gets said.
      store.show({ ...patch, title: patch.title, id });
    }
  },
  dismiss(id?: string) {
    store.dismiss(id);
    if (!store.hasHost() && id) toast.dismiss(id);
  },
};

// ── Motion ────────────────────────────────────────────────────────────────

/** Reanimated's {duration, dampingRatio} springs, in motion's terms. */
const spring = (ms: number, dampingRatio: number, extra: Record<string, number> = {}) => ({
  type: "spring" as const,
  visualDuration: ms / 1000,
  bounce: Math.max(0, 1 - dampingRatio),
  ...extra,
});

type Phase = "idle" | "entering" | "shown" | "exiting";

type Els = {
  gooIsland?: SVGRectElement | null;
  neck?: SVGRectElement | null;
  drop?: SVGRectElement | null;
  shadow?: SVGRectElement | null;
  island?: SVGRectElement | null;
  card?: HTMLDivElement | null;
};

/** The state machine behind one mounted island. Lives outside React state so
 *  the springs drive the SVG directly, sixty times a second, without renders. */
function createController() {
  const v = {
    pill: motionValue(0),
    drop: motionValue(0),
    expand: motionValue(0),
    reveal: motionValue(0),
    tint: motionValue(0),
    dragY: motionValue(0),
  };
  const els: Els = {};
  let layout: IslandLayout | null = null;
  let shown: ActiveNotice | null = null;
  let phase: Phase = "idle";
  let reduce = false;
  let revealAt = 0;
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let advanceTimer: ReturnType<typeof setTimeout> | undefined;
  let running: AnimationPlaybackControls[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function paint() {
    if (!layout) return;
    const L = layout;
    const g = islandGeometry(v.drop.get(), v.expand.get(), L);
    const dragY = v.dragY.get();
    const pill = clamp(v.pill.get(), 0, 1.2);
    const pillW = mix(pill, ISLAND.height, ISLAND.width);
    const set = (el: SVGRectElement | null | undefined, x: number, y: number, w: number, h: number, r: number) => {
      if (!el) return;
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(Math.max(0, w)));
      el.setAttribute("height", String(Math.max(0, h)));
      el.setAttribute("rx", String(Math.max(0, r)));
    };
    const inset = 3.7;
    set(els.island, L.centerX - pillW / 2, L.islandTop, pillW, ISLAND.height, ISLAND.height / 2);
    els.island?.setAttribute("opacity", String(clamp(pill * 1.6, 0, 1)));
    set(els.gooIsland, L.centerX - pillW / 2 + inset, L.islandTop + inset, pillW - inset * 2, ISLAND.height - inset * 2, ISLAND.height / 2 - inset);
    els.gooIsland?.setAttribute("opacity", String(clamp(pill, 0, 1)));
    set(els.neck, g.neckX, g.neckY, g.neckWidth, g.neckHeight, g.neckRadius);
    set(els.drop, g.x, g.y + dragY, g.width, g.height, g.radius);
    els.drop?.setAttribute("fill", mixHex(ISLAND_COLOR, CARD_COLOR, (v.tint.get() - 0.06) / 0.82));
    set(els.shadow, g.x, g.y + dragY, g.width, g.height, g.radius);
    els.shadow?.setAttribute("opacity", String(clamp(v.expand.get(), 0, 1)));

    const card = els.card;
    if (card) {
      const r = clamp(v.reveal.get(), 0, 1);
      const scale = mix(r, 0.88, 1) + clamp(g.widthRatio - 1, 0, 0.2) * r;
      card.style.transform = `translateY(${g.offsetY + dragY}px) scale(${scale})`;
      card.style.opacity = String(r);
      card.style.filter = r < 0.995 ? `blur(${((1 - r) * 10).toFixed(2)}px)` : "none";
      card.style.pointerEvents = r > 0.6 && phase !== "exiting" ? "auto" : "none";
    }
  }

  const schedulePaint = () => frame.render(paint);

  function run(value: MotionValue<number>, to: number, transition: object) {
    const controls = animate(value, to, transition);
    running.push(controls);
    return controls;
  }

  function stopAll() {
    running.forEach((c) => c.stop());
    running = [];
  }

  function clearTimers() {
    clearTimeout(dismissTimer);
    clearTimeout(advanceTimer);
    dismissTimer = undefined;
    advanceTimer = undefined;
  }

  function lifetime(n: ActiveNotice) {
    if (n.loading) return null;
    return n.duration === undefined ? DEFAULT_DURATION : n.duration;
  }

  /** Auto-dismiss, counted from when the text is fully revealed. */
  function arm(ms?: number) {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    if (!shown) return;
    const life = lifetime(shown);
    if (life === null) return;
    const id = shown.id;
    const wait = Math.max(0, revealAt - Date.now()) + (ms ?? life);
    dismissTimer = setTimeout(() => store.dismiss(id), wait);
  }

  /** Something is waiting behind this notice: give it the floor soon. */
  function yieldSoon() {
    if (!shown || advanceTimer || shown.loading) return;
    const id = shown.id;
    const wait = Math.max(0, revealAt + MIN_VISIBLE - Date.now());
    advanceTimer = setTimeout(() => store.dismiss(id), wait);
  }

  function enter(n: ActiveNotice) {
    shown = n;
    phase = "entering";
    stopAll();
    clearTimers();
    for (const key of ["drop", "expand", "reveal", "tint", "dragY"] as const) v[key].set(0);
    emit();

    if (reduce) {
      v.pill.set(1);
      v.drop.set(1);
      v.expand.set(1);
      v.tint.set(1);
      revealAt = Date.now() + 200;
      run(v.reveal, 1, { duration: 0.2 }).then(() => { if (phase === "entering") phase = "shown"; });
      arm();
      return;
    }

    // The island wakes first when it was asleep; between back-to-back
    // notices it stays up and the next drop falls straight away.
    const lead = v.pill.get() > 0.5 ? 0 : 0.18;
    run(v.pill, 1, spring(450, 0.7));
    run(v.drop, 1, spring(1150, 0.82, { delay: lead }));
    run(v.tint, 1, spring(700, 1, { delay: lead + 0.11 }));
    run(v.expand, 1, spring(1000, 0.8, { delay: lead + 0.34 }));
    run(v.reveal, 1, spring(700, 1, { delay: lead + 0.56 })).then(() => {
      if (phase === "entering") phase = "shown";
    });
    revealAt = Date.now() + (lead + 0.56) * 1000;
    arm();
  }

  function exit() {
    if (phase === "exiting" || phase === "idle") return;
    phase = "exiting";
    clearTimers();
    stopAll();
    const done = () => settle();
    if (reduce) {
      run(v.reveal, 0, { duration: 0.15 }).then(done);
      return;
    }
    run(v.reveal, 0, spring(360, 1));
    run(v.expand, 0, spring(660, 0.92, { delay: 0.1, velocity: 2 }));
    run(v.tint, 0, spring(1150, 0.9, { delay: 0.28 }));
    run(v.drop, 0, spring(1150, 0.9, { delay: 0.28 })).then(done);
  }

  function settle() {
    if (phase !== "exiting") return;
    phase = "idle";
    shown = null;
    for (const key of ["drop", "expand", "reveal", "tint", "dragY"] as const) v[key].set(0);
    emit();
    if (store.getSnapshot().length === 0) {
      if (reduce) v.pill.set(0);
      else run(v.pill, 0, spring(400, 1));
    }
    sync();
  }

  /** Reconcile what is on screen with the head of the queue. */
  function sync() {
    if (!layout) return;
    const items = store.getSnapshot();
    const head = items[0];
    if (phase === "exiting") return; // settle() calls back in
    if (!shown) {
      if (head) enter(head);
      return;
    }
    if (head?.id !== shown.id) {
      exit();
      return;
    }
    if (head !== shown) {
      // Updated in place: the card morphs and the new text gets its full time
      // (a loading notice that just finished starts its clock now).
      shown = head;
      emit();
      arm();
    }
    if (items.length > 1) yieldSoon();
  }

  return {
    v,
    els,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    getShown: () => shown,
    setReduce(value: boolean) { reduce = value; },
    setLayout(next: IslandLayout) {
      layout = next;
      schedulePaint();
      sync();
    },
    paint: schedulePaint,
    start() {
      const offs = Object.values(v).map((mv) => mv.on("change", schedulePaint));
      const offStore = store.subscribe(sync);
      const detach = store.attachHost();
      sync();
      return () => {
        offs.forEach((off) => off());
        offStore();
        detach();
        stopAll();
        clearTimers();
        cancelFrame(paint);
      };
    },
    /** Hover or a finger on the card holds it on screen. */
    hold() {
      clearTimeout(dismissTimer);
      dismissTimer = undefined;
      clearTimeout(advanceTimer);
      advanceTimer = undefined;
    },
    release() {
      if (!shown || phase === "exiting") return;
      arm(1500);
      if (store.getSnapshot().length > 1) yieldSoon();
    },
    springBack() {
      run(v.dragY, 0, spring(560, 0.7));
    },
    isInteractive: () => phase === "entering" || phase === "shown",
  };
}

// ── Host ──────────────────────────────────────────────────────────────────

function readSafeTop() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;height:env(safe-area-inset-top);width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

export function DynamicIsland() {
  const [c] = React.useState(createController);
  const shown = React.useSyncExternalStore(c.subscribe, c.getShown, () => null);
  const reduce = useReducedMotion() ?? false;
  const [layout, setLayout] = React.useState<IslandLayout | null>(null);
  const filterId = React.useId().replace(/:/g, "");

  React.useEffect(() => c.setReduce(reduce), [c, reduce]);

  React.useEffect(() => {
    const measure = () => setLayout(islandLayout(window.innerWidth, readSafeTop()));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  React.useEffect(() => {
    if (layout) c.setLayout(layout);
  }, [c, layout]);

  React.useEffect(() => c.start(), [c]);

  // Repaint once the elements exist for a new notice.
  React.useLayoutEffect(() => { c.paint(); }, [c, shown, layout]);

  /* Vertical pan: up past a small threshold (or a flick) dismisses, a little
     downward give, otherwise it springs home. A press without movement is a tap. */
  const gesture = React.useRef<{ y0: number; d0: number; lastY: number; lastT: number; vy: number; moved: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!c.isInteractive()) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    c.hold();
    gesture.current = { y0: e.clientY, d0: c.v.dragY.get(), lastY: e.clientY, lastT: e.timeStamp, vy: 0, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.y0;
    if (Math.abs(dy) > 6) g.moved = true;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.vy = ((e.clientY - g.lastY) / dt) * 1000;
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    c.v.dragY.set(clamp(g.d0 + dy, -120, 24));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g || !shown) return;
    if (!g.moved) {
      if (shown.onPress) press();
      else c.release();
      return;
    }
    if (c.v.dragY.get() < -18 || g.vy < -420) {
      store.dismiss(shown.id);
    } else {
      c.springBack();
      c.release();
    }
  }

  function press() {
    if (!shown) return;
    shown.onPress?.();
    store.dismiss(shown.id);
  }

  if (!layout) return null;

  const svgHeight = layout.cardTop + CARD.height + 64;
  const tone = TONE[shown?.tone ?? "gold"];
  const Icon = shown?.icon;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90]">
      <svg
        width={layout.width}
        height={svgHeight}
        className="absolute left-0 top-0 overflow-visible"
        aria-hidden
      >
        <defs>
          <filter id={`${filterId}-goo`} filterUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height={svgHeight} colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="14.3" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9.46" />
          </filter>
          <filter id={`${filterId}-shadow`} filterUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height={svgHeight} colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceAlpha" stdDeviation="14" />
            <feOffset dy="10" />
            <feColorMatrix values="0 0 0 0 0.063  0 0 0 0 0.075  0 0 0 0 0.11  0 0 0 0.35 0" />
          </filter>
        </defs>
        <rect ref={(el) => { c.els.shadow = el; }} fill={CARD_COLOR} filter={`url(#${filterId}-shadow)`} opacity={0} />
        <g filter={`url(#${filterId}-goo)`}>
          <rect ref={(el) => { c.els.gooIsland = el; }} fill={ISLAND_COLOR} opacity={0} />
          <rect ref={(el) => { c.els.neck = el; }} fill={ISLAND_COLOR} />
          <rect ref={(el) => { c.els.drop = el; }} fill={ISLAND_COLOR} />
        </g>
        <rect ref={(el) => { c.els.island = el; }} fill={ISLAND_COLOR} opacity={0} />
      </svg>

      {/* Screen readers hear the notice; the card itself is decoration plus a tap target. */}
      <div role="status" aria-live="polite" className="sr-only">
        {shown ? `${shown.title}${shown.message ? `. ${shown.message}` : ""}` : ""}
      </div>

      {shown && (
        <div
          ref={(el) => { c.els.card = el; }}
          role={shown.onPress ? "button" : undefined}
          tabIndex={shown.onPress ? 0 : undefined}
          aria-label={shown.onPress ? `${shown.title}. ${shown.actionLabel ?? "Open"}` : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerEnter={() => c.hold()}
          onPointerLeave={() => { if (!gesture.current) c.release(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(); }
            if (e.key === "Escape") store.dismiss(shown.id);
          }}
          style={{
            left: layout.centerX - layout.cardWidth / 2,
            top: layout.cardTop,
            width: layout.cardWidth,
            height: CARD.height,
            borderRadius: CARD.height / 2,
            opacity: 0,
            pointerEvents: "none",
            touchAction: "none",
          }}
          className={cn(
            "absolute flex select-none items-center gap-3 pl-[13px] pr-5 outline-none will-change-transform",
            "focus-visible:ring-2 focus-visible:ring-gold/60",
            shown.onPress ? "cursor-pointer" : "cursor-grab",
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${shown.loading ? "loading" : shown.tone ?? "gold"}|${shown.image ?? ""}`}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: "spring", visualDuration: 0.35, bounce: 0.45 }}
              className="relative grid size-[46px] shrink-0 place-items-center overflow-hidden rounded-full"
              style={{ background: shown.image ? "#e8e9eb" : tone.bg, color: tone.fg }}
            >
              {shown.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shown.image} alt="" draggable={false} className="size-full object-cover" />
              ) : shown.loading ? (
                <Loader2 className="size-5 animate-spin" strokeWidth={2.5} />
              ) : Icon ? (
                <Icon className="size-[22px]" strokeWidth={2.25} />
              ) : null}
              {shown.image && shown.loading && (
                <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
                  <Loader2 className="size-5 animate-spin" strokeWidth={2.5} />
                </span>
              )}
            </motion.span>
          </AnimatePresence>

          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${shown.title}|${shown.message ?? ""}`}
              initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
              transition={{ type: "spring", visualDuration: 0.4, bounce: 0.2 }}
              className="min-w-0 flex-1"
            >
              <p className="truncate font-sans text-[17px] font-bold leading-tight tracking-[-0.35px]" style={{ color: shown.tone && shown.tone !== "gold" ? tone.text : "#0b0b0d" }}>
                {shown.title}
              </p>
              {shown.message && (
                <p className="mt-px truncate font-sans text-sm font-medium tracking-[-0.2px] text-[#77787d]">{shown.message}</p>
              )}
            </motion.div>
          </AnimatePresence>

          {shown.onPress && !shown.loading && (
            <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold" style={{ color: tone.text }}>
              {shown.actionLabel ?? null}
              <ChevronRight className="size-[18px]" strokeWidth={2.5} />
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
