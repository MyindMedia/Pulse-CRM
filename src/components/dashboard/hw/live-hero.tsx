"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCapabilities } from "@/lib/use-capabilities";
import { errorMessage } from "@/lib/errors";
import { proposalNotice } from "@/lib/change-proposal";
import { useOpenSession } from "@/lib/use-open-session";
import { Chassis, elapsed, hhmm, usd, useNow } from "./parts";

type Today = FunctionReturnType<typeof api.today.today>;
type Row = Today["sessions"][number];

const SERVICE: Record<string, string> = {
  recording: "Recording",
  mixing: "Mixing",
  mastering: "Mastering",
  production: "Production",
  consultation: "Consultation",
  rehearsal: "Rehearsal",
  writing: "Writing",
};
const VERB: Record<string, string> = {
  recording: "tracking",
  mixing: "mixing",
  mastering: "mastering",
  production: "producing",
  consultation: "in a consultation",
  rehearsal: "rehearsing",
  writing: "writing",
};
const serviceLabel = (s: Row) => (s.serviceType === "custom" ? s.customService || "Session" : SERVICE[s.serviceType] ?? "Session");
const DEAD = new Set(["cancelled", "no_show"]);

/** The session running now, or else the next one today. */
export function pickLive(sessions: Row[], now: number): { live: Row | null; next: Row | null } {
  const live =
    sessions.find(
      (s) => (s.status === "in_progress" || s.status === "confirmed") && s.startTime <= now && s.endTime > now,
    ) ?? null;
  const next = sessions.find((s) => s.startTime > now && !DEAD.has(s.status)) ?? null;
  return { live, next };
}

/* The overview's hero (kit 6.2): what is happening in the studio right now,
 * on the blueprint grid, with the lens module on the right. Every sentence
 * is assembled from today's bookings; nothing here is made up. */
export function LiveSessionHero() {
  const data = useQuery(api.today.today, {});
  const now = useNow(1000);
  const { can } = useCapabilities();

  if (!data || now === null) {
    return (
      <Chassis grid brackets className="min-h-[300px]" aria-busy>
        <span className="sr-only">Loading the studio</span>
      </Chassis>
    );
  }

  const { live, next } = pickLive(data.sessions, now);
  const money = data.canSeeFinancials;

  return (
    <Chassis grid brackets className="flex-row! gap-6 p-0!">
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-6 pt-5">
        {live ? (
          <LiveBody s={live} next={next} now={now} money={money} canEdit={can("sessions.edit")} />
        ) : next ? (
          <NextBody s={next} now={now} money={money} />
        ) : (
          <IdleBody count={data.sessions.filter((s) => !DEAD.has(s.status)).length} tomorrow={data.tomorrow} />
        )}
      </div>
      <LensModule on={Boolean(live)} />
    </Chassis>
  );
}

function Head({ kicker, status, title }: { kicker: React.ReactNode; status?: React.ReactNode; title: string }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        {kicker}
        {status}
      </div>
      <h2 className="mt-3 font-sans text-base font-bold! leading-[22px] tracking-[-0.01em] text-bone">{title}</h2>
      <span className="pl-bar mt-2.5 w-12" aria-hidden />
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-sans text-[11px] uppercase leading-4 text-steel">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function DepositChip({ paid }: { paid: boolean | null }) {
  if (paid === null) return null;
  return <Badge tone={paid ? "positive" : "caution"}>{paid ? "Paid" : "Due"}</Badge>;
}

function LiveBody({ s, next, now, money, canEdit }: { s: Row; next: Row | null; now: number; money: boolean; canEdit: boolean }) {
  const extend = useMutation(api.sessions.extend);
  const openSession = useOpenSession();
  const hours = Math.max(0.25, (s.endTime - s.startTime) / 3_600_000);
  const where = s.roomName ? `in ${s.roomName}` : "in the studio";
  const nextLine = next
    ? `; next up is ${next.clientName}${next.roomName ? ` in ${next.roomName}` : ""} at ${hhmm(next.startTime)}.`
    : ".";

  async function add(minutes: number) {
    try {
      const res = await extend({ id: s._id as Id<"sessions">, addMinutes: minutes });
      if (!proposalNotice(res)) toast.success(`Extended ${minutes} minutes.`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not extend the session."));
    }
  }

  return (
    <>
      <Head
        kicker={<Badge tone="solid">Live now</Badge>}
        status={
          <Badge tone="gold" className="gap-1.5">
            <span className="pl-led" data-on="true" data-live="true" aria-hidden />
            {serviceLabel(s)}
          </Badge>
        }
        title={`${s.roomName ?? "The studio"} is in session`}
      />
      <p className="mt-4 max-w-[26rem] font-sans text-sm leading-5 text-mist">
        {s.clientName} is {VERB[s.serviceType] ?? "in session"} {where}
        {s.engineerName ? ` with ${s.engineerName}` : ""}. Session ends at {hhmm(s.endTime)}
        {nextLine}
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="Elapsed">
          <span role="timer" className="font-mono text-[22px] font-medium leading-7 text-gold tabular-nums" aria-label={`${elapsed(now - s.startTime)} elapsed`}>
            {elapsed(now - s.startTime)}
          </span>
        </Figure>
        {money && s.rateCents !== null ? (
          <>
            <Figure label="Rate">
              <span className="font-mono text-[22px] font-medium leading-7 text-bone tabular-nums">{usd(s.rateCents / hours)}/h</span>
            </Figure>
            <Figure label="Deposit">
              <div className="flex h-7 items-center">
                <DepositChip paid={s.depositPaid} />
              </div>
            </Figure>
          </>
        ) : (
          <Figure label="Engineer">
            <span className="font-sans text-[15px] leading-7 text-bone">{s.engineerName ?? "Unassigned"}</span>
          </Figure>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">Extend session</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => void add(15)}>15 minutes</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void add(30)}>30 minutes</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void add(60)}>1 hour</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button size="sm" variant="secondary" data-drill="session" onClick={() => openSession(s._id)}>
          Add notes
        </Button>
        {s.roomId && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/studio/${s.roomId}`}>Open room</Link>
          </Button>
        )}
      </div>
    </>
  );
}

function NextBody({ s, now, money }: { s: Row; now: number; money: boolean }) {
  const openSession = useOpenSession();
  return (
    <>
      <Head kicker={<Badge tone="gold">Up next</Badge>} title={`${s.roomName ?? "The studio"} is free until ${hhmm(s.startTime)}`} />
      <p className="mt-4 max-w-[26rem] font-sans text-sm leading-5 text-mist">
        {s.clientName} is booked for {serviceLabel(s).toLowerCase()}
        {s.roomName ? ` in ${s.roomName}` : ""} from {hhmm(s.startTime)} to {hhmm(s.endTime)}
        {s.engineerName ? ` with ${s.engineerName}` : ""}.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
        <Figure label="Starts in">
          <span role="timer" className="font-mono text-[22px] font-medium leading-7 text-gold tabular-nums" aria-label={`Starts in ${elapsed(s.startTime - now)}`}>{elapsed(s.startTime - now)}</span>
        </Figure>
        <Figure label="Engineer">
          <span className="font-sans text-[15px] leading-7 text-bone">{s.engineerName ?? "Unassigned"}</span>
        </Figure>
        {money && (
          <Figure label="Deposit">
            <div className="flex h-7 items-center">
              <DepositChip paid={s.depositPaid} />
            </div>
          </Figure>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
        <Button size="sm" variant="secondary" data-drill="session" onClick={() => openSession(s._id)}>
          Open booking
        </Button>
      </div>
    </>
  );
}

function IdleBody({ count, tomorrow }: { count: number; tomorrow: Today["tomorrow"] }) {
  const line =
    tomorrow.count > 0 && tomorrow.firstStart
      ? `Tomorrow has ${tomorrow.count} ${tomorrow.count === 1 ? "session" : "sessions"}, the first at ${hhmm(tomorrow.firstStart)}.`
      : "Nothing is booked for tomorrow yet.";
  return (
    <>
      <Head kicker={<Badge tone="neutral">Today</Badge>} title={count > 0 ? "Today's sessions are done" : "No sessions today"} />
      <p className="mt-4 max-w-[26rem] font-sans text-sm leading-5 text-mist">{line}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
        <Button size="sm" variant="secondary" asChild>
          <Link href="/calendar">Open calendar</Link>
        </Button>
      </div>
    </>
  );
}

/** The raised module with a lens in its screen. Decorative; lights up while
 *  a session is live. */
function LensModule({ on }: { on: boolean }) {
  return (
    <div className="hidden w-[214px] shrink-0 self-stretch p-0.5 md:block" aria-hidden>
      <div className="pl-module h-full">
        <div className="pl-screen relative h-full overflow-hidden">
          {[148, 118, 96, 72].map((d, i) => (
            <span
              key={d}
              className="pl-lens-ring"
              style={{ width: d, height: d, opacity: i === 2 ? 1 : 0.55, borderWidth: i === 2 ? 3 : 1.5 }}
            />
          ))}
          <span
            className="absolute inset-0 m-auto size-2.5 rounded-full"
            style={{
              background: on ? "var(--pl-yellow)" : "var(--pl-metal-500)",
              boxShadow: on ? "var(--pl-glow-yellow-soft)" : "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}
