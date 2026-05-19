"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const GOLD = "#fdb913";
const AXIS = "#6c6c76";

const PALETTE = ["#fdb913", "#5db4ff", "#3ddc91", "#c084fc", "#ff8f6b", "#ffd24a", "#7dd3fc"];

type TipEntry = { name?: string | number; value?: number | string };

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-hairline-2 bg-coal-2 px-3 py-2 shadow-pop">
      {label != null && (
        <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">{label}</p>
      )}
      {payload.map((p, i) => (
        <p key={i} className="text-xs font-medium text-bone">
          {p.name}: <span className="text-gold">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/** Revenue-style area chart with a gold gradient fill. */
export function TrendArea({
  data,
  xKey,
  yKey,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
            <stop offset="100%" stopColor={GOLD} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey={xKey} stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} width={48} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: AXIS, strokeDasharray: 3 }} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={GOLD}
          strokeWidth={2}
          fill="url(#goldFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar chart — pipeline stages, lead sources. */
export function HBars({
  data,
  labelKey,
  valueKey,
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={labelKey}
          stroke={AXIS}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={88}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#ffffff08" }} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut — bookings by service type, etc. */
export function CategoryDonut({
  data,
  labelKey,
  valueKey,
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Tooltip content={<ChartTooltip />} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={labelKey}
          innerRadius={48}
          outerRadius={78}
          paddingAngle={3}
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export { PALETTE };
