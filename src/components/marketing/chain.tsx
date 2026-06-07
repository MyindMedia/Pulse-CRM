import { MessageSquare, CalendarCheck, Mic2, Scissors, Rocket, DollarSign } from "lucide-react";
import { Reveal } from "./reveal";

/** The signature differentiator: every other tool drops the thread somewhere
 *  between the inquiry and the payout. Pulse keeps it as one chain. */
const STEPS = [
  { icon: MessageSquare, label: "Inquiry", note: "Lead lands, captured" },
  { icon: CalendarCheck, label: "Booking", note: "Room held, deposit paid" },
  { icon: Mic2, label: "Session", note: "Recorded, revised" },
  { icon: Scissors, label: "Splits", note: "Shares locked, e-signed" },
  { icon: Rocket, label: "Release", note: "Rolled out" },
  { icon: DollarSign, label: "Royalty", note: "Money tracked home" },
];

export function Chain() {
  return (
    <section id="workflow" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="overline">One unbroken chain</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            From inquiry to{" "}
            <span className="font-serif text-[1.15em] font-normal italic text-gold">royalty</span>,
            nothing falls through
          </h2>
          <p className="mt-4 text-ash">
            Other tools cover one link and drop the rest. Pulse threads the whole
            record together, so every session, split and dollar stays connected.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {STEPS.map((s, i) => (
            <Reveal key={s.label} delay={i * 70}>
              <div className="hover-glow group relative h-full rounded-xl border border-hairline bg-coal/40 p-5 hover:-translate-y-1 hover:border-gold-dim hover:bg-coal-2/60">
                <span className="grid size-10 place-items-center rounded-lg border border-hairline-2 bg-coal-2 text-gold transition-all duration-300 group-hover:scale-110 group-hover:border-gold-dim">
                  <s.icon className="size-4" />
                </span>
                <p className="mt-4 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ash-dim">
                  Step {i + 1}
                </p>
                <p className="mt-1 font-display text-lg font-semibold text-bone">{s.label}</p>
                <p className="mt-1 text-sm text-ash">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
