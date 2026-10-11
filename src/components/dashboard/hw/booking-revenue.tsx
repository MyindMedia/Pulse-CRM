"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Chassis, ChassisTitle, KeyBank, usd } from "./parts";

type Range = "30d" | "90d" | "ytd";
const RANGES = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
] as const;

const W = 600;
const H = 150;

/* Collected revenue over time (kit 6.2 "booking revenue chart"): one yellow
 * series that glows, a yellow fade under it, the 8% yellow grid, and a
 * dashed cursor. Drawn as plain SVG for now; slice 5 moves it to Bklit's
 * AreaChart with the same tokens (openspec/changes/hardware-ui, task 4.3). */
export function BookingRevenue() {
  const [range, setRange] = React.useState<Range>("30d");
  const series = useQuery(api.dashboard.revenueSeries, { range });
  const points = series?.points ?? [];
  const [hover, setHover] = React.useState<number | null>(null);
  const id = React.useId().replace(/:/g, "");

  const max = Math.max(0, ...points.map((p) => p.cents));
  const top = max > 0 ? max * 1.15 : 1;
  const xy = points.map((p, i) => ({
    x: points.length > 1 ? (i / (points.length - 1)) * W : W / 2,
    y: H - (p.cents / top) * (H - 8),
  }));
  const line = smoothPath(xy);
  const area = xy.length ? `${line} L${W},${H} L0,${H} Z` : "";
  const cursor = hover ?? (xy.length ? xy.length - 1 : null);
  const total = points.reduce((s, p) => s + p.cents, 0);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (points.length < 2) return;
    const box = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1)))));
  }

  return (
    <Chassis>
      <ChassisTitle
        title="Booking revenue"
        bar={false}
        right={<KeyBank label="Revenue range" options={RANGES} value={range} onChange={setRange} />}
      />
      <div className="pl-screen relative mt-5 min-h-[140px] flex-1 overflow-hidden">
        {series === undefined ? (
          <p className="absolute inset-0 grid place-items-center font-sans text-xs text-steel">Loading revenue…</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full touch-none"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Collected ${usd(total)} over the range`}
          >
            <defs>
              <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--pl-yellow)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--pl-yellow)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`v${i}`} x1={(i / 12) * W} y1={0} x2={(i / 12) * W} y2={H} stroke="rgba(255,201,0,0.08)" vectorEffect="non-scaling-stroke" />
            ))}
            {Array.from({ length: 5 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i / 4) * H} x2={W} y2={(i / 4) * H} stroke="rgba(255,201,0,0.08)" vectorEffect="non-scaling-stroke" />
            ))}
            {area && <path d={area} fill={`url(#fill-${id})`} />}
            {line && (
              <path
                d={line}
                fill="none"
                stroke="var(--pl-yellow)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                style={{ filter: "drop-shadow(0 0 4px rgba(255,201,0,0.6))" }}
              />
            )}
            {cursor !== null && xy[cursor] && (
              <line
                x1={xy[cursor].x}
                y1={0}
                x2={xy[cursor].x}
                y2={H}
                stroke="var(--pl-yellow)"
                strokeOpacity={0.7}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
        {/* The cursor dot and its reading sit outside the stretched SVG so they stay round. */}
        {series !== undefined && cursor !== null && xy[cursor] && (
          <>
            <span
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--pl-on-yellow)] bg-gold"
              style={{ left: `${(xy[cursor].x / W) * 100}%`, top: `${(xy[cursor].y / H) * 100}%` }}
              aria-hidden
            />
            {hover !== null && (
              <span
                className="pointer-events-none absolute top-2 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-[var(--pl-face)] px-2 py-1 font-mono text-[11px] text-bone shadow-[var(--pl-shadow-key)]"
                style={{ left: `${Math.min(85, Math.max(15, (xy[cursor].x / W) * 100))}%` }}
              >
                {points[cursor].label} · {usd(points[cursor].cents)}
              </span>
            )}
          </>
        )}
        {series !== undefined && max === 0 && (
          <p className="absolute inset-x-0 bottom-3 text-center font-sans text-xs text-steel">No revenue collected in this range yet.</p>
        )}
      </div>
      {points.length > 0 && (
        <div className="mt-2 flex justify-between font-mono text-[11px] leading-4 text-steel">
          <span>{points[0].label}</span>
          <span>{points[Math.floor((points.length - 1) / 2)].label}</span>
          <span>{points[points.length - 1].label}</span>
        </div>
      )}
    </Chassis>
  );
}

/** A smooth line through the points that never overshoots them (monotone
 *  cubic, Fritsch-Carlson), so a quiet day is never drawn below zero. */
export function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const n = pts.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x || 1));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    path += ` C${(pts[i].x + dx).toFixed(1)},${(pts[i].y + m[i] * dx).toFixed(1)} ${(pts[i + 1].x - dx).toFixed(1)},${(pts[i + 1].y - m[i + 1] * dx).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return path;
}
