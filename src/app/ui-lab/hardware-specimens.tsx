"use client";

import * as React from "react";
import { Bell, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Brackets } from "@/components/shell/page-header-slot";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Chassis, ChassisTitle, Delta, Groove, KeyBank, StatTile, usd } from "@/components/dashboard/hw/parts";
import { PERIODS, type Period } from "@/components/dashboard/hw/period";

/* The shell and overview parts with sample data, for the staging-only UI lab.
 * The real screens need a signed-in studio; these use the same classes and
 * components, so Chromium, Firefox and WebKit (Safari) can all render and
 * check them without a login. Every value here is labelled sample data. */

const REVENUE = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(2026, 8, 10 + i),
  revenue: Math.round(900 + i * 55 + Math.sin(i / 2.2) * 420 + (i % 7 === 5 ? 650 : 0)),
}));

export function HardwareSpecimens() {
  const [period, setPeriod] = React.useState<Period>("day");
  const [range, setRange] = React.useState<"30d" | "90d" | "ytd">("30d");

  return (
    <section aria-label="Shell and overview specimens (sample data)" className="flex flex-col gap-6" data-testid="hw-specimens">
      <p className="pl-label">Shell and overview, sample data</p>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar chassis */}
        <aside className="pl-card pl-side relative w-full shrink-0 pb-6 lg:w-[232px]" data-testid="spec-sidebar">
          <Brackets />
          <div className="px-[33px] pt-6">
            <div className="pl-emboss w-[100px]">
              <PulseLogo size="full" asLink={false} />
            </div>
            <span className="pl-bar mt-3 w-[72px]" aria-hidden />
          </div>
          <nav className="px-[17px]">
            <p className="pl-label px-4 pb-2 pt-6">Studio</p>
            <ul className="space-y-0.5">
              <li>
                <a href="#" data-active="true" aria-current="page" className="pl-nav-item">
                  <span className="pl-led" data-on="true" aria-hidden />
                  Dashboard
                </a>
              </li>
              {["Bookings", "Calendar", "Rooms and gear"].map((l) => (
                <li key={l}>
                  <a href="#" data-active="false" className="pl-nav-item">
                    <span className="pl-led" aria-hidden />
                    {l}
                  </a>
                </li>
              ))}
            </ul>
            <p className="pl-label px-4 pb-2 pt-6">Locked on your plan</p>
            <a href="#" data-locked="true" className="pl-nav-item">
              <span className="pl-led" aria-hidden />
              Payroll
              <span className="ml-auto grid size-4 place-items-center rounded-[4px] border border-steel/30 text-[9px] font-bold text-steel">G</span>
            </a>
            <div className="pl-well mx-4 mt-6 px-3 py-3">
              <p className="font-sans text-[10.5px] uppercase leading-[14px] tracking-[0.04em] text-steel">Plan</p>
              <p className="mt-0.5 font-sans text-[15px] font-bold leading-5 text-bone">Growth</p>
              <p className="mt-0.5 font-sans text-xs leading-4 text-mist">3 rooms, 6 staff</p>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* Top bar chassis */}
          <header className="pl-card relative flex flex-wrap items-center gap-4 px-6 py-3 lg:min-h-[76px]" data-testid="spec-topbar">
            <Brackets />
            <div className="min-w-0">
              <h1 className="font-sans text-[26px] font-extrabold leading-8 tracking-[-0.01em] text-bone">Good evening, Lawrence</h1>
              <p className="font-sans text-[11px] leading-4 text-steel">Friday, October 9 · 3 sessions today (sample)</p>
            </div>
            <button type="button" className="pl-search flex min-w-[200px] flex-1">
              <Search className="size-4 shrink-0" />
              <span className="truncate">Search clients, sessions, invoices</span>
            </button>
            <KeyBank label="Period (sample)" options={PERIODS} value={period} onChange={setPeriod} />
            <button type="button" aria-label="Notifications" className="pl-icon-key grid">
              <Bell className="size-[1.1rem]" />
            </button>
            <Button>New booking</Button>
          </header>

          {/* Hero + month tiles */}
          <div className="grid gap-6 xl:grid-cols-[1.54fr_1fr]">
            <Chassis grid brackets className="flex-row! gap-6 p-0!" data-testid="spec-hero">
              <div className="flex min-w-0 flex-1 flex-col px-6 pb-6 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <Badge tone="solid">Live now</Badge>
                  <Badge tone="gold" className="gap-1.5">
                    <span className="pl-led" data-on="true" data-live="true" aria-hidden />
                    Recording
                  </Badge>
                </div>
                <h2 className="mt-3 font-sans text-base font-bold! leading-[22px] text-bone">Studio A is in session</h2>
                <span className="pl-bar mt-2.5 w-12" aria-hidden />
                <p className="mt-4 max-w-[26rem] font-sans text-sm leading-5 text-mist">
                  Sample: Nova Vega is tracking vocals in Studio A with J. Ortiz. Session ends at 14:00.
                </p>
                <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p className="font-sans text-[11px] uppercase leading-4 text-steel">Elapsed</p>
                    <span role="timer" aria-label="2 hours 14 minutes 37 seconds elapsed" className="font-mono text-[22px] font-medium leading-7 text-gold">
                      02:14:37
                    </span>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] uppercase leading-4 text-steel">Rate</p>
                    <span className="font-mono text-[22px] font-medium leading-7 text-bone">$150/h</span>
                  </div>
                  <div>
                    <p className="font-sans text-[11px] uppercase leading-4 text-steel">Deposit</p>
                    <div className="flex h-7 items-center">
                      <Badge tone="positive">Paid</Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
                  <Button size="sm">Extend session</Button>
                  <Button size="sm" variant="secondary">Add notes</Button>
                  <Button size="sm" variant="ghost">Open room</Button>
                </div>
              </div>
              <div className="hidden w-[214px] shrink-0 self-stretch p-0.5 md:block" aria-hidden>
                <div className="pl-module h-full min-h-[260px]">
                  <div className="pl-screen relative h-full overflow-hidden">
                    {[148, 118, 96, 72].map((d, i) => (
                      <span key={d} className="pl-lens-ring" style={{ width: d, height: d, opacity: i === 2 ? 1 : 0.55, borderWidth: i === 2 ? 3 : 1.5 }} />
                    ))}
                    <span className="absolute inset-0 m-auto size-2.5 rounded-full" style={{ background: "var(--pl-yellow)", boxShadow: "var(--pl-glow-yellow-soft)" }} />
                  </div>
                </div>
              </div>
            </Chassis>

            <Chassis data-testid="spec-kpis">
              <ChassisTitle title="October (sample)" />
              <div className="mt-3 grid flex-1 grid-cols-2 gap-3">
                <StatTile label="Revenue" value={usd(4825000)} highlight foot={<Delta value={0.124} against="Sep" />} />
                <StatTile label="Booked hours" value="312" foot={<Delta value={0.041} against="Sep" />} />
                <StatTile label="Deposits held" value={usd(540000)} foot="14 bookings" />
                <StatTile label="Outstanding" value={usd(690000)} foot={<Delta value={-0.083} against="Sep" />} />
              </div>
            </Chassis>
          </div>

          {/* Revenue, rooms, table */}
          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Chassis data-testid="spec-revenue">
              <ChassisTitle
                title="Booking revenue (sample)"
                bar={false}
                right={
                  <KeyBank
                    label="Revenue range (sample)"
                    options={[
                      { value: "30d", label: "30D" },
                      { value: "90d", label: "90D" },
                      { value: "ytd", label: "YTD" },
                    ]}
                    value={range}
                    onChange={setRange}
                  />
                }
              />
              <div className="pl-well mt-3 flex flex-col p-3">
                <div className="pl-screen relative h-[170px] overflow-hidden">
                  <AreaChart data={REVENUE} xDataKey="date" aspectRatio="auto" style={{ height: "100%" }} margin={{ top: 14, right: 26, bottom: 26, left: 26 }}>
                    <Grid horizontal vertical stroke="var(--chart-grid)" strokeOpacity={1} />
                    <Area dataKey="revenue" fill="var(--chart-line-primary)" fillOpacity={0.32} fadeEdges strokeWidth={2} />
                    <XAxis numTicks={3} />
                    <ChartTooltip matchCrosshair indicatorColor="var(--pl-yellow)" indicatorDasharray="3 3" />
                  </AreaChart>
                </div>
              </div>
            </Chassis>

            <Chassis data-testid="spec-rooms">
              <ChassisTitle title="Room utilization (sample)" bar={false} />
              <div className="mt-3 flex flex-col gap-4">
                {[
                  ["Studio A", 0.82, "yellow"],
                  ["Studio B", 0.64, "metal"],
                  ["Mix Suite", 0.47, "metal"],
                ].map(([name, v, tone]) => (
                  <div key={name as string}>
                    <div className="mb-2 flex justify-between font-sans text-[13px] leading-[18px]">
                      <span className="text-mist">{name}</span>
                      <span className="font-mono text-xs text-bone">{Math.round((v as number) * 100)}%</span>
                    </div>
                    <Groove value={v as number} tone={tone as "yellow" | "metal"} />
                  </div>
                ))}
                <div>
                  <div className="mb-2 flex justify-between font-sans text-[13px] leading-[18px]">
                    <span className="text-mist">Monthly goal</span>
                    <span className="font-mono text-xs text-bone">{usd(4825000)} / {usd(6000000)}</span>
                  </div>
                  <Groove value={0.804} tone="yellow" knob />
                </div>
              </div>
            </Chassis>
          </div>

          <Chassis data-testid="spec-table">
            <ChassisTitle title="Today's sessions (sample)" bar={false} right={<Button size="sm" variant="secondary">Open calendar</Button>} />
            <div className="pl-well mt-3 p-3">
              <div className="pl-screen overflow-x-auto px-3 py-1">
                <table className="pl-table w-full min-w-[34rem] border-collapse font-sans text-[13px] leading-[18px]">
                  <thead>
                    <tr className="h-11">
                      <th className="px-3">Client</th>
                      <th className="px-3">Room</th>
                      <th className="px-3">Time</th>
                      <th className="px-3">Status</th>
                      <th className="px-3 text-right!">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Nova Vega", "Studio A", "10:00 to 14:00", "Paid", "positive", 60000, false],
                      ["Kei Marlow", "Studio B", "15:00 to 19:00", "Deposit", "gold", 45000, true],
                      ["Lot 9 Records", "Mix Suite", "20:00 to 02:00", "Balance due", "critical", 120000, false],
                    ].map(([c, r, tm, st, tone, cents, sel]) => (
                      <tr key={c as string} data-selected={sel ? "true" : undefined} className="h-[61px]" data-testid={sel ? "spec-selected-row" : undefined}>
                        <td className="px-3 text-bone">{c}</td>
                        <td className="px-3 text-mist">{r}</td>
                        <td className="px-3 font-mono text-mist">{tm}</td>
                        <td className="px-3">
                          <Badge tone={tone as "positive" | "gold" | "critical"}>{st}</Badge>
                        </td>
                        <td className="px-3 text-right font-mono text-bone">{usd(cents as number, { cents: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Chassis>
        </div>
      </div>
    </section>
  );
}
