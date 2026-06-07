import {
  Music2,
  CalendarDays,
  ScrollText,
  Ticket,
  Receipt,
  Sparkles,
} from "lucide-react";
import { Reveal } from "./reveal";

const FEATURES = [
  {
    icon: Music2,
    title: "Song-centric catalog",
    blurb:
      "Every record in flight, from demo to master, with versions and revisions tracked in one place.",
  },
  {
    icon: CalendarDays,
    title: "Sessions and scheduling",
    blurb:
      "Book rooms, schedule staff and see who is working where. No more double-booked rooms.",
  },
  {
    icon: ScrollText,
    title: "Splits and licensing",
    blurb:
      "Lock split sheets, collect e-signatures and manage sync placements and beat licenses.",
  },
  {
    icon: Ticket,
    title: "Bookings and deposits",
    blurb:
      "Public booking pages take deposits straight to your own Stripe account. You keep 100 percent.",
  },
  {
    icon: Receipt,
    title: "Payments and cash flow",
    blurb:
      "Invoices, deposits and revenue in one command center, so you can see exactly where money leaks.",
  },
  {
    icon: Sparkles,
    title: "The AI Agent",
    blurb:
      "A studio operations manager that drafts replies, chases leads and keeps the pipeline moving.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="overline">Everything in one place</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            Run the whole studio, not a pile of apps
          </h2>
          <p className="mt-4 text-ash">
            Pulse replaces the spreadsheet, the booking form, the split sheet and the
            invoice tool with one connected system.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <div className="group h-full rounded-2xl border border-hairline bg-coal/40 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold-dim hover:bg-coal-2/60 hover:shadow-elev-3">
                <span className="grid size-11 place-items-center rounded-xl border border-hairline-2 bg-coal-2 text-gold transition-colors group-hover:border-gold-dim group-hover:text-gold-bright">
                  <f.icon className="size-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold text-bone">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ash">{f.blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
