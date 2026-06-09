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
    <section id="features" className="relative bg-bone px-4 py-28 text-obsidian lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-slate">Everything in one place</p>
          <h2 className="chrome-display chrome-fill-dark mt-4 text-4xl sm:text-5xl">
            Run the <span className="not-italic text-gold-deep">whole</span> studio, not a pile of apps
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-slate">
            Pulse replaces the spreadsheet, the booking form, the scheduling app and the
            invoice tool with one connected system.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <div className="group h-full rounded-chrome border border-graphite/20 bg-paper p-6 transition-all hover:-translate-y-1 hover:border-obsidian">
                <span className="grid size-11 place-items-center rounded-chrome border border-graphite/20 bg-fog text-gold-deep transition-all duration-300 group-hover:scale-110 group-hover:border-gold-deep">
                  <f.icon className="size-5" />
                </span>
                <h3 className="font-grotesk mt-5 text-xl font-semibold tracking-[-0.01em] text-obsidian">{f.title}</h3>
                <p className="font-grotesk mt-2 text-sm leading-relaxed text-slate">{f.blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
