"use client";

import * as React from "react";
import {
  Sparkles,
  Gauge,
  Workflow,
  MessageSquare,
  Network,
  TrendingUp,
  ShieldAlert,
  Mail,
  ShieldCheck,
  Lock,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/dialog";

type Capability = { icon: LucideIcon; title: string; blurb: string };

/** Each AI capability working inside the studio, in plain language. */
const CAPABILITIES: Capability[] = [
  {
    icon: Gauge,
    title: "Studio Manager",
    blurb:
      "Evaluates where the studio stands like a seasoned manager: scores your standing, weighs profitability, risk and your client relationships, and posts a daily brief with the few things that matter most and why.",
  },
  {
    icon: Workflow,
    title: "Operations autopilot",
    blurb:
      "Watches the day-to-day and prepares the next move: convert new leads, chase deposits and overdue invoices, confirm tentative sessions, fill cancellations, nudge no-show risks, and flag pricing opportunities.",
  },
  {
    icon: MessageSquare,
    title: "Ask anything",
    blurb:
      "A conversational manager you can ask about bookings, revenue, leads, sessions, gear value or follow-ups. It answers only from this studio's own data, with continuity across history.",
  },
  {
    icon: Network,
    title: "Studio Brain (graph + memory)",
    blurb:
      "Builds a living map of your studio - who your strongest client relationships are, who engineers what, which assets sit idle - plus a running history, so it reasons with memory instead of a single snapshot.",
  },
  {
    icon: TrendingUp,
    title: "Profitability coach",
    blurb:
      "Grades your studio against best-practice benchmarks (utilization, no-shows, deposit capture, collections, repeat rate and more) and surfaces dollar-quantified ways to make more money.",
  },
  {
    icon: ShieldAlert,
    title: "Risk radar",
    blurb:
      "Spots problems before they bite across every area: stale pipeline, stalled songs, unexecuted split sheets, double-booked rooms, unstaffed sessions, overtime and single-engineer dependency.",
  },
  {
    icon: Mail,
    title: "Drafts that sound like you",
    blurb:
      "Writes warm, on-brand client emails - lead follow-ups, payment reminders, recaps, prep packets and revision triage - ready for you to review, edit and send.",
  },
];

type Guard = { icon: LucideIcon; title: string; blurb: string };

/** The guardrails that govern how the agents behave. */
const GUARDRAILS: Guard[] = [
  {
    icon: ShieldCheck,
    title: "Approval-first",
    blurb:
      "Anything client-facing, financial, file, or automation-related is prepared and waits in your approval inbox. The agent never sends on its own unless you raise its autonomy.",
  },
  {
    icon: Lock,
    title: "Your studio only",
    blurb:
      "Every agent sees this sub-account's data and nothing else. It can never read, compare against, or mention another studio.",
  },
  {
    icon: CircleCheck,
    title: "Grounded and verified",
    blurb:
      "The agent reads the real numbers (it never makes them up), and every drafted message is checked for invented amounts or placeholders before it ever reaches you.",
  },
];

/**
 * Explains how the Pulse Agent agents behave and lists what they can do. Opened
 * from the AI section header. Read-only, purely informational.
 */
export function AgentInfoModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-gold/12 text-gold">
              <Sparkles className="size-4" />
            </span>
            How the Pulse Agent works
          </DialogTitle>
          <DialogDescription>
            Your AI runs the studio&apos;s busywork like a team of specialists. It reads this
            studio&apos;s live data, flags what matters, and prepares actions for your approval - it
            never sends anything on its own unless you let it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-5 overflow-y-auto">
          <section className="space-y-2.5">
            <h3 className="font-meta text-[0.6875rem] uppercase tracking-[0.08em] text-steel/70">
              What it can do
            </h3>
            <div className="space-y-2">
              {CAPABILITIES.map((c) => (
                <div
                  key={c.title}
                  className="flex gap-3 rounded-lg border border-graphite/50 bg-coal-2 p-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
                    <c.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-grotesk text-sm font-semibold text-bone">{c.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-steel">{c.blurb}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <h3 className="font-meta text-[0.6875rem] uppercase tracking-[0.08em] text-steel/70">
              How it stays safe
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {GUARDRAILS.map((g) => (
                <div key={g.title} className="rounded-lg border border-graphite/50 bg-coal/40 p-3">
                  <span className="grid size-8 place-items-center rounded-lg bg-positive/10 text-positive">
                    <g.icon className="size-4" />
                  </span>
                  <p className="mt-2 font-grotesk text-sm font-semibold text-bone">{g.title}</p>
                  <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-steel">{g.blurb}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="rounded-lg border border-graphite/50 bg-coal/40 px-3 py-2.5 text-[0.6875rem] leading-relaxed text-steel/80">
            Tune the agent in <span className="text-bone">Agent settings</span>: turn it on or off,
            set the tone, raise autonomy from suggest-only to auto, and toggle the daily brief. What
            it learns about your studio lives in <span className="text-bone">Agent memory</span>,
            private to this studio.
          </p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
