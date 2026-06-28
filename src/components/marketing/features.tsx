import {
  Sparkles,
  Ticket,
  CalendarClock,
  Boxes,
  Music2,
  Receipt,
} from "lucide-react";
import { Reveal } from "./reveal";
import { GhostWord } from "./ghost-word";

const FEATURES = [
  {
    icon: Sparkles,
    title: "AI operations manager",
    blurb:
      "Automates the busywork: chases unpaid deposits, follows up on leads, fills cancellations and flags scheduling and payment risks before they cost you. It only ever sees your studio.",
  },
  {
    icon: Ticket,
    title: "Bookings and deposits",
    blurb:
      "Public booking pages take deposits straight to your own Stripe account. You keep 100 percent, with no per-booking fees.",
  },
  {
    icon: CalendarClock,
    title: "Staffing and scheduling",
    blurb:
      "Schedule engineers and assistants to rooms and sessions in one calendar. Everyone sees their shifts, and no session runs unstaffed or double-booked.",
  },
  {
    icon: Boxes,
    title: "Inventory tracking",
    blurb:
      "Track every mic, plugin and piece of furniture, check gear out to rooms and sessions, and stay ahead of each license renewal, repair and asset value.",
  },
  {
    icon: Music2,
    title: "Songs, splits and rights",
    blurb:
      "Move every song from demo to release, lock split sheets with e-signatures and store ISRC and ISWC. Pulse holds a release until the splits are signed.",
  },
  {
    icon: Receipt,
    title: "Payments and cash flow",
    blurb:
      "Invoices, deposits and revenue in one place, so you always know what is owed, what is overdue and where money is leaking.",
  },
];

export function Features() {
  return (
    <section id="features" className="theme-light-island relative overflow-hidden bg-coal px-4 py-28 text-bone lg:px-8">
      <GhostWord word="FEATURES" className="text-bone/[0.05]" />
      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-slate">Recording studio management software</p>
          <h2 className="chrome-display chrome-fill-dark mt-4 text-4xl sm:text-5xl">
            Run the <span className="not-italic text-gold-deep">whole</span> studio, not ten apps
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-slate">
            Bookings, scheduling, inventory, payments and song rights live in one
            system, and an AI manager runs the day-to-day, so you stop stitching
            apps together and chasing admin.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <div className="group h-full rounded-chrome border border-graphite/20 bg-paper p-6 transition-all hover:-translate-y-1 hover:border-obsidian">
                <span className="grid size-11 place-items-center rounded-chrome border border-graphite/20 bg-fog text-gold-deep transition-all duration-300 group-hover:scale-110 group-hover:border-gold-deep">
                  <f.icon className="size-5" />
                </span>
                <h3 className="font-grotesk mt-5 text-xl font-semibold tracking-[-0.01em] text-bone">{f.title}</h3>
                <p className="font-grotesk mt-2 text-sm leading-relaxed text-slate">{f.blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
