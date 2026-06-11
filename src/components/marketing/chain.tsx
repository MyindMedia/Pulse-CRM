import { CalendarCheck, DoorOpen, CalendarClock, Boxes, Clock, Receipt } from "lucide-react";
import { ChainRail } from "./chain-rail";
import { Reveal } from "./reveal";

/** The studio-operations automation flow: one booking moves itself through
 *  rooms, staff, gear and billing with no manual hand-offs. */
const STEPS = [
  { icon: CalendarCheck, label: "Booking", note: "Booked online, deposit auto-collected" },
  { icon: DoorOpen, label: "Room", note: "Auto-assigned, never double-booked" },
  { icon: CalendarClock, label: "Staff", note: "Engineer scheduled to the room" },
  { icon: Boxes, label: "Inventory", note: "Gear checked out to the session" },
  { icon: Clock, label: "Session", note: "Hours tracked while the room runs" },
  { icon: Receipt, label: "Invoice", note: "Balance auto-invoiced and paid" },
];

export function Chain() {
  return (
    <section id="workflow" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-steel">Studio booking software, automated</p>
          <h2 className="chrome-display mt-4 text-4xl leading-[1.05] text-bone sm:text-5xl">
            From booking to <span className="text-gold">paid</span>, the studio runs itself
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/80">
            Rooms, staff, gear and invoices stay in sync automatically. Every booking
            flows through the studio on its own, so nothing slips and no one chases
            paperwork.
          </p>
        </Reveal>

        {/* Signature: the chain literally draws itself in on scroll. */}
        <div className="mt-14 hidden px-8 lg:block">
          <ChainRail count={STEPS.length} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:mt-8 lg:grid-cols-6">
          {STEPS.map((s, i) => (
            <Reveal key={s.label} delay={i * 70}>
              <div className="hover-glow group relative h-full rounded-chrome border border-graphite/50 bg-obsidian/50 p-5 transition-all hover:-translate-y-1 hover:border-bone/40">
                <span className="grid size-10 place-items-center rounded-chrome border border-graphite/60 bg-obsidian text-gold transition-all duration-300 group-hover:scale-110 group-hover:border-gold">
                  <s.icon className="size-4" />
                </span>
                <p className="chrome-meta mt-4 text-steel/80">Step {i + 1}</p>
                <p className="font-grotesk mt-1 text-lg font-semibold tracking-[-0.01em] text-bone">{s.label}</p>
                <p className="font-grotesk mt-1 text-sm text-mist/75">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
