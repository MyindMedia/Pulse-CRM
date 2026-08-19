"use client";

import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { cableColorHex, levelMeta } from "./constants";
import {
  subscribeCableJolt,
  readCableJolt,
  readCableJoltServer,
} from "./cable-jolt";

export type PatchRenderMode = "bubble" | "schematic" | "cable";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/* Spring constants for the cable wobble. Heavily underdamped: a real cable
   dropped back against a rack swings through several times before it stops,
   and a spring that eases straight to rest reads as a CSS transition rather
   than a physical object. Damping ratio here is about 0.14, which rings for
   roughly two and a half seconds - close to what Reason's patch cables do. */
const STIFFNESS = 62;
const DAMPING = 2.6;
/* The lateral swing is looser and lasts longer than the vertical bounce. */
const SWAY_STIFFNESS = 34;
const SWAY_DAMPING = 1.6;
const MAX_VELOCITY = 320;
/* How far the belly of a cable may travel from where it hangs at rest. Wide
   enough that a hard drag visibly throws it, bounded so a long run across
   the canvas never loops back over the devices it connects. */
const SAG_LIFT = 70;
const SAG_DROP = 150;
const SWAY_LIMIT = 120;
/* The smallest throw a release is allowed to be. Without a floor, setting a
   device down carefully produces no swing at all, and the interaction reads
   as broken to anyone who moved something slowly. */
const RELEASE_FLOOR = 105;

/** Stagger for the travelling arrowheads, in seconds against a 1.9s cycle. */
const ARROW_OFFSETS = [-1.9, -1.267, -0.633];

export type PatchEdgeData = {
  /** bubble draws bezier curves, schematic orthogonal runs, cable hangs slack. */
  mode: PatchRenderMode;
  signalLevel: string;
  cableColor: string | null;
  cableTag: string | null;
  /** Labels at each end, when the run is labelled per end. */
  cableTagSource: string | null;
  cableTagTarget: string | null;
  isNormalled: boolean;
  /** Permanent wiring in the wall between two panels, not a cable. */
  isTieLine: boolean;
  animated: boolean;
  traceDimmed: boolean;
  /** No cable assigned from stock yet. */
  unassigned: boolean;
};

/**
 * How much slack a run has, in pixels of droop.
 *
 * A real cable between two points hangs in a catenary whose depth depends
 * on how much longer the cable is than the gap. Short gaps look almost
 * limp, long gaps pull nearly straight. Modelling that, rather than a
 * fixed curve, is most of what makes these read as cables and not arcs.
 */
function restingSag(dx: number, dy: number): number {
  const span = Math.hypot(dx, dy);
  // Slack grows with span but saturates: a 2000px run is not 500px of droop.
  const slack = 34 + span * 0.16;
  return Math.min(slack, 130);
}

/**
 * A hanging cable as a cubic bezier. Control points sit inboard of each
 * end and pushed down by the sag, which puts the lowest point in the
 * middle and keeps the tangents leaving each jack roughly horizontal, the
 * way a cable actually leaves a socket.
 */
function cablePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sag: number,
  sway: number,
): [string, number, number] {
  const dx = tx - sx;

  // A cable leaves an output jack heading out of the right of the box and
  // enters an input jack from the left of the box, always. When the
  // destination sits behind the source the cable has to bow out and come
  // back, so the grip grows instead of flipping, which is what a real
  // cable does rather than cutting through the chassis.
  const behind = dx < 40;
  const grip = behind
    ? Math.max(86, Math.min(Math.abs(dx) * 0.6 + 86, 240))
    : Math.max(28, Math.min(dx * 0.36, 160));

  // The sway pushes the belly of the cable sideways, so a knocked rack
  // makes its loom swing across as well as bounce.
  const c1x = sx + grip + sway;
  const c2x = tx - grip + sway * 0.55;
  const c1y = sy + sag;
  const c2y = ty + sag;

  // Lowest point of a symmetric cubic sits at t = 0.5.
  const midX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
  const midY = (sy + 3 * c1y + 3 * c2y + ty) / 8;
  return [`M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`, midX, midY];
}

/**
 * Spring the sag toward its resting value, and kick it when the endpoints
 * move. Dragging a rack across the canvas should make the cables on it
 * swing and settle, because that is the single cheapest cue that these are
 * physical objects hanging in a room rather than lines on a diagram.
 */
function useCableSwing(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  enabled: boolean,
  sourceNode: string,
  targetNode: string,
) {
  const target = restingSag(tx - sx, ty - sy);
  const [motion, setMotion] = React.useState({ sag: target, sway: 0 });

  const jolt = React.useSyncExternalStore(
    subscribeCableJolt,
    readCableJolt,
    readCableJoltServer,
  );

  const state = React.useRef({
    sag: target,
    sagVelocity: 0,
    sway: 0,
    swayVelocity: 0,
    prevX: sx,
    prevY: sy,
    joltSeq: 0,
    raf: 0,
  });

  React.useEffect(() => {
    const s = state.current;

    if (!enabled) {
      s.sag = target;
      s.sagVelocity = 0;
      s.sway = 0;
      s.swayVelocity = 0;
      return;
    }

    // A device was just put down. Only runs that touch it care, and they
    // take the throw the hand was carrying - with a floor, so even a cable
    // set down gently visibly settles instead of arriving already dead.
    if (
      jolt.seq !== s.joltSeq &&
      (jolt.nodes.has(sourceNode) || jolt.nodes.has(targetNode))
    ) {
      s.joltSeq = jolt.seq;
      const throwSpeed = Math.hypot(jolt.vx, jolt.vy);
      const kick = clamp(RELEASE_FLOOR + throwSpeed * 0.32, RELEASE_FLOOR, MAX_VELOCITY);
      s.sagVelocity = clamp(s.sagVelocity + kick, -MAX_VELOCITY, MAX_VELOCITY);
      s.swayVelocity = clamp(
        s.swayVelocity - Math.sign(jolt.vx || 1) * (RELEASE_FLOOR * 0.7 + Math.abs(jolt.vx) * 0.3),
        -MAX_VELOCITY,
        MAX_VELOCITY,
      );
    }

    // Movement since the last frame becomes momentum. Vertical movement
    // mostly pumps the sag, horizontal mostly pushes the belly sideways,
    // which is what makes a dragged rack look like it is dragging weight.
    const dx = sx - s.prevX;
    const dy = sy - s.prevY;
    s.prevX = sx;
    s.prevY = sy;

    const moved = Math.hypot(dx, dy);
    if (moved > 0.3) {
      s.sagVelocity = clamp(
        s.sagVelocity + (Math.abs(dy) * 1.15 + Math.abs(dx) * 0.55),
        -MAX_VELOCITY,
        MAX_VELOCITY,
      );
      s.swayVelocity = clamp(s.swayVelocity - dx * 1.55, -MAX_VELOCITY, MAX_VELOCITY);
    }

    let last = performance.now();

    function step(now: number) {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      s.sagVelocity = clamp(
        s.sagVelocity + (-STIFFNESS * (s.sag - target) - DAMPING * s.sagVelocity) * dt,
        -MAX_VELOCITY,
        MAX_VELOCITY,
      );
      s.sag = clamp(s.sag + s.sagVelocity * dt, target - SAG_LIFT, target + SAG_DROP);

      // The sideways swing is looser and settles slower, the way the
      // middle of a hanging cable keeps moving after the ends stop.
      s.swayVelocity = clamp(
        s.swayVelocity + (-SWAY_STIFFNESS * s.sway - SWAY_DAMPING * s.swayVelocity) * dt,
        -MAX_VELOCITY,
        MAX_VELOCITY,
      );
      s.sway = clamp(s.sway + s.swayVelocity * dt, -SWAY_LIMIT, SWAY_LIMIT);

      // Sized to the last visible frame, not to zero. Half a flow unit is
      // sub-pixel at every zoom the canvas offers, so anything below this is
      // rAF spent on motion nobody can see - with a dozen runs on screen that
      // is a dozen animation loops running for seconds after the eye is done.
      const settled =
        Math.abs(s.sag - target) < 0.5 &&
        Math.abs(s.sagVelocity) < 1.2 &&
        Math.abs(s.sway) < 0.5 &&
        Math.abs(s.swayVelocity) < 1.2;

      if (settled) {
        s.sag = target;
        s.sagVelocity = 0;
        s.sway = 0;
        s.swayVelocity = 0;
        s.raf = 0;
        setMotion({ sag: target, sway: 0 });
        return;
      }
      setMotion({ sag: s.sag, sway: s.sway });
      s.raf = requestAnimationFrame(step);
    }

    if (!s.raf) s.raf = requestAnimationFrame(step);
    return () => {
      if (s.raf) {
        cancelAnimationFrame(s.raf);
        s.raf = 0;
      }
    };
  }, [sx, sy, tx, ty, target, enabled, jolt, sourceNode, targetNode]);

  return enabled ? motion : { sag: target, sway: 0 };
}

/**
 * One cable run. Colour comes from the jacket when the studio recorded
 * one, otherwise from signal level, so an undocumented rig still reads
 * correctly and a documented one matches what you see behind the rack.
 *
 * The moving dash is a display layer only. It never carries meaning that
 * is not already in the data, and it switches off above the connection
 * threshold and under prefers-reduced-motion.
 */
export const PatchEdge = React.memo(function PatchEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps & { data?: PatchEdgeData }) {
  const mode = data?.mode ?? "bubble";
  const normalled = data?.isNormalled;
  /* Copper in a wall. Drawn like neither a patch cord nor a normal: it is
     real wiring, so it gets a solid line, but it hangs off nothing and
     swings from nothing, so it gets no physics and no jacket. */
  const tie = data?.isTieLine;
  const fixed = normalled || tie;

  // Physics only in cable mode, and never for wiring that is inside a bay
  // or inside a wall - neither has a cable to swing.
  const swingOn = mode === "cable" && !fixed;
  const { sag, sway } = useCableSwing(
    sourceX,
    sourceY,
    targetX,
    targetY,
    swingOn,
    source,
    target,
  );

  const [path, labelX, labelY] = React.useMemo(() => {
    if (mode === "cable") {
      return cablePath(sourceX, sourceY, targetX, targetY, sag, sway);
    }
    if (mode === "schematic") {
      return getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        borderRadius: 2,
        // Lane separation: runs leave the box before turning, so parallel
        // cables do not stack into one indistinguishable line.
        offset: 24,
      });
    }
    return getBezierPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      curvature: 0.35,
    });
  }, [mode, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sag, sway]);

  const stroke =
    cableColorHex(data?.cableColor) ?? levelMeta(data?.signalLevel ?? "line").color;

  const animated = data?.animated && !normalled;
  const isCable = mode === "cable" && !fixed;

  // How far inboard the end labels sit, and how far they drop to clear the
  // cable itself. Scaled down on short runs so the two never collide.
  const span = Math.abs(targetX - sourceX);
  const endInset = Math.max(26, Math.min(span * 0.22, 62));
  const endDrop = isCable ? 11 : 9;

  return (
    <>
      {/* In cable mode a darker under-stroke reads as the shadowed side of
          a round jacket. One extra path buys most of the depth. */}
      {isCable && (
        <path
          d={path}
          fill="none"
          stroke="#000"
          strokeOpacity={data?.traceDimmed ? 0.06 : 0.5}
          strokeWidth={selected ? 7 : 5.5}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: isCable ? (selected ? 4 : 3) : selected ? 3 : 2,
          strokeLinecap: isCable ? "round" : undefined,
          // A normalled connection is implied by the bay, not run with a
          // cable. Dashing it stops the map claiming a patch cord exists.
          // Everything else stays a solid jacket in every mode; direction
          // is carried by the light travelling along it, not by chopping
          // the cable into pieces.
          // A normalled connection is implied by the bay; a tie line is
          // buried in a wall. Neither is a cable anyone can point at, and
          // both get a dash so the map cannot claim a patch cord exists.
          // The tie line's dash is longer: it is real copper, just not
          // copper you can reach.
          strokeDasharray: normalled ? "2 4" : tie ? "10 5" : undefined,
          opacity: data?.traceDimmed ? 0.12 : normalled ? 0.55 : tie ? 0.8 : 1,
          filter: selected ? `drop-shadow(0 0 5px ${stroke})` : undefined,
        }}
      />

      {/* A thin highlight along the top of the jacket. */}
      {isCable && !data?.traceDimmed && (
        <path
          d={path}
          fill="none"
          stroke="#fff"
          strokeOpacity={0.16}
          strokeWidth={selected ? 1.2 : 1}
          strokeLinecap="round"
          pointerEvents="none"
          transform="translate(0,-1)"
        />
      )}

      {/* Signal direction. Light running along the jacket rather than the
          jacket itself moving, so the cable reads as a solid object with
          something travelling through it. Two passes: a soft halo in the
          cable's own colour, then a bright white core on top. */}
      {animated && !data?.traceDimmed && (
        <>
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={isCable ? 9 : 8}
            strokeDasharray="7 15"
            strokeLinecap="round"
            className="patch-edge-flow"
            opacity={0.55}
            pointerEvents="none"
            style={{ filter: "blur(3px)" }}
          />
          <path
            d={path}
            fill="none"
            stroke="#ffffff"
            strokeWidth={isCable ? 2.6 : 2.2}
            strokeDasharray="7 15"
            strokeLinecap="round"
            className="patch-edge-flow"
            pointerEvents="none"
            style={{
              filter: `drop-shadow(0 0 3px rgba(255,255,255,0.95)) drop-shadow(0 0 7px ${stroke})`,
            }}
          />

          {/* Arrowheads riding the cable. animateMotion follows the real
              path and rotate="auto" turns each head along the tangent, so
              they lean into the sag instead of pointing flat. Negative
              begin values stagger them without waiting a full cycle. */}
          {ARROW_OFFSETS.map((offset) => (
            <polygon
              key={offset}
              points="-3.4,-2.6 3.6,0 -3.4,2.6 -1.9,0"
              fill="#ffffff"
              pointerEvents="none"
              style={{
                filter: `drop-shadow(0 0 4px rgba(255,255,255,0.9)) drop-shadow(0 0 8px ${stroke})`,
              }}
            >
              <animateMotion
                dur="1.9s"
                begin={`${offset}s`}
                repeatCount="indefinite"
                rotate="auto"
                keyPoints="0;1"
                keyTimes="0;1"
                calcMode="linear"
                path={path}
              />
            </polygon>
          ))}
        </>
      )}

      {/* Labels. A real cable is marked in three places: once in the middle
          saying what it is, and once at each end saying where the other end
          goes. The end labels sit just inboard of the jacks, which is where
          the tape actually is. */}
      {!normalled && (
        <EdgeLabelRenderer>
          {data?.cableTagSource && (
            <div
              style={{
                transform: `translate(-50%, -50%) translate(${sourceX + endInset}px, ${sourceY + endDrop}px)`,
                opacity: data?.traceDimmed ? 0.15 : 1,
              }}
              className="pointer-events-none absolute z-[1] max-w-32 truncate rounded-[3px] border border-graphite/70 bg-coal/95 px-1 py-px font-meta text-[8px] uppercase tracking-wide text-bone shadow-elev-1"
            >
              {data.cableTagSource}
            </div>
          )}

          {(data?.cableTag || data?.unassigned) && (
            <div
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                opacity: data?.traceDimmed ? 0.15 : 1,
              }}
              className="pointer-events-none absolute z-[1] rounded-[3px] border border-graphite/70 bg-coal/95 px-1 py-px font-meta text-[8px] uppercase tracking-wide text-bone shadow-elev-1"
            >
              {data?.cableTag ?? "no cable"}
            </div>
          )}

          {data?.cableTagTarget && (
            <div
              style={{
                transform: `translate(-50%, -50%) translate(${targetX - endInset}px, ${targetY + endDrop}px)`,
                opacity: data?.traceDimmed ? 0.15 : 1,
              }}
              className="pointer-events-none absolute z-[1] max-w-32 truncate rounded-[3px] border border-graphite/70 bg-coal/95 px-1 py-px font-meta text-[8px] uppercase tracking-wide text-bone shadow-elev-1"
            >
              {data.cableTagTarget}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
});
