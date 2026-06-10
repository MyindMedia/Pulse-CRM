import {
  Ticket,
  DoorOpen,
  CalendarClock,
  Boxes,
  Receipt,
  Workflow,
} from "lucide-react";
import { Reveal } from "./reveal";
import { GhostWord } from "./ghost-word";

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

/* Dylanbrouwer-style service pillars: gradient panel + slow-turning rendered
 * chrome icon, titles below. The 6-card grid underneath carries the detail. */
const PILLARS = [
  {
    img: "/icon-wave.png",
    title: "Run",
    blurb: "Sessions, rooms and staff in one calendar, always in sync.",
  },
  {
    img: "/icon-coin.png",
    title: "Get paid",
    blurb: "Deposits and invoices land straight in your own Stripe account.",
  },
  {
    img: "/icon-spark.png",
    title: "Automate",
    blurb: "Bookings move themselves from deposit to invoice to payout.",
  },
];

export function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-bone px-4 py-28 text-obsidian lg:px-8">
      <GhostWord word="FEATURES" className="text-obsidian/[0.05]" />
      <div className="relative z-10 mx-auto max-w-6xl">
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

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 90}>
              <div className="group h-full rounded-chrome border border-graphite/20 bg-paper p-4">
                <div
                  className="grid aspect-[4/3] place-items-center overflow-hidden rounded-chrome [perspective:700px]"
                  style={{ background: "linear-gradient(to bottom, #ececea 0%, #c9c8cb 45%, #46464a 100%)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.img}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="icon-turn w-2/5 select-none [transform-style:preserve-3d]"
                  />
                </div>
                <h3 className="font-grotesk mt-5 px-2 text-2xl font-semibold tracking-[-0.01em] text-obsidian">
                  {p.title}
                </h3>
                <p className="font-grotesk mt-1.5 px-2 pb-2 text-sm leading-relaxed text-slate">{p.blurb}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
