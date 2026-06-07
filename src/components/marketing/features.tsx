import {
  Ticket,
  DoorOpen,
  CalendarClock,
  Boxes,
  Receipt,
  Workflow,
} from "lucide-react";
import { Reveal } from "./reveal";

const FEATURES = [
  {
    icon: Ticket,
    title: "Bookings and deposits",
    blurb:
      "Public booking pages take deposits straight to your own Stripe account. You keep 100 percent.",
  },
  {
    icon: DoorOpen,
    title: "Room management",
    blurb:
      "Assign and track every room, see what is free at a glance, and never double-book again.",
  },
  {
    icon: CalendarClock,
    title: "Staff scheduling",
    blurb:
      "Schedule engineers and staff to rooms and sessions in one calendar. Everyone knows where to be.",
  },
  {
    icon: Boxes,
    title: "Inventory and assets",
    blurb:
      "Track gear, software and furniture, check items out to rooms, and know the value of every asset.",
  },
  {
    icon: Receipt,
    title: "Payments and cash flow",
    blurb:
      "Invoices, deposits and revenue in one command center, so you can see exactly where money leaks.",
  },
  {
    icon: Workflow,
    title: "Automations and workflows",
    blurb:
      "A booking moves itself from deposit to invoice, with room, staff and gear handled automatically.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="overline">Everything in one place</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            Run the{" "}
            <span className="font-serif text-[1.15em] font-normal italic text-gold">whole</span>{" "}
            studio, not a pile of apps
          </h2>
          <p className="mt-4 text-ash">
            Pulse replaces the spreadsheet, the booking form, the scheduling app and the
            invoice tool with one connected system.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <div className="hover-glow group h-full rounded-2xl border border-hairline bg-coal/40 p-6 hover:-translate-y-1 hover:border-gold-dim hover:bg-coal-2/60">
                <span className="grid size-11 place-items-center rounded-xl border border-hairline-2 bg-coal-2 text-gold transition-all duration-300 group-hover:scale-110 group-hover:border-gold-dim group-hover:text-gold-bright">
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
