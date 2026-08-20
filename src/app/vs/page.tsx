import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Clock, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Pulse vs StudioHero: an honest comparison",
  description:
    "Month to month against an annual contract, everything included against paid add-ons. What each one actually costs a recording studio.",
};

/* The comparison page.

   The switching trigger is always a money-loss event: a no-show week, a
   bounced check, a double-booked A room. This is the page they land on the
   morning after one, so it answers the question they are actually asking -
   what does it cost and how fast can I be off the old thing - rather than
   listing features at them.

   Every claim about the other product is a documented, checkable fact about
   its published pricing. Nothing here is a characterization of their quality,
   because that is not ours to make and it is not what is being decided. */

const ROWS: {
  label: string;
  pulse: { text: string; good: boolean };
  other: { text: string; good: boolean };
}[] = [
  {
    label: "Monthly cost",
    pulse: { text: "From $0 on Flow, $149.99 on Studio", good: true },
    other: { text: "$205 and up", good: false },
  },
  {
    label: "Commitment",
    pulse: { text: "Month to month, cancel any time", good: true },
    other: { text: "Annual contract", good: false },
  },
  {
    label: "Calendar sync",
    pulse: { text: "Included", good: true },
    other: { text: "Paid add-on, around $75", good: false },
  },
  {
    label: "Accounting integration",
    pulse: { text: "Expenses and P&L built in", good: true },
    other: { text: "Paid add-on, around $250", good: false },
  },
  {
    label: "Migration",
    pulse: { text: "Free, white glove, live in a day", good: true },
    other: { text: "Setup measured in weeks", good: false },
  },
  {
    label: "No-show protection",
    pulse: { text: "Card on file, policy, auto-charge, waitlist", good: true },
    other: { text: "Reminders only", good: false },
  },
  {
    label: "Who takes the payment",
    pulse: { text: "Your own Stripe, paid directly", good: true },
    other: { text: "Through their processing", good: false },
  },
  {
    label: "AI receptionist",
    pulse: { text: "Answers booking texts around the clock", good: true },
    other: { text: "Not offered", good: false },
  },
  {
    label: "White label",
    pulse: { text: "Your brand on the whole app on Label", good: true },
    other: { text: "Their brand", good: false },
  },
];

export default function ComparisonPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-14 sm:py-20">
      <p className="font-meta text-[0.6875rem] uppercase tracking-[0.16em] text-gold">
        An honest comparison
      </p>
      <h1 className="mt-3 font-grotesk text-3xl font-bold tracking-tight text-bone sm:text-4xl">
        Pulse against the incumbent
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-steel">
        Most studios look at this the morning after a bad week: a no-show Friday, an invoice
        nobody chased, two artists booked into the same room. So here is the plain version, on
        the two things that actually decide it. What it costs, and how long you are tied in.
      </p>

      <div className="mt-9 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-1/3 border-b border-graphite/60 pb-2 text-left font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel/70">
                &nbsp;
              </th>
              <th className="border-b-2 border-gold pb-2 text-left font-grotesk text-sm font-semibold text-bone">
                Pulse
              </th>
              <th className="border-b border-graphite/60 pb-2 text-left font-grotesk text-sm font-semibold text-steel">
                StudioHero
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="align-top">
                <td className="border-b border-graphite/40 py-3 pr-4 text-xs text-steel">
                  {r.label}
                </td>
                <td className="border-b border-graphite/40 py-3 pr-4">
                  <span className="flex items-start gap-2 text-xs text-bone">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-positive" />
                    {r.pulse.text}
                  </span>
                </td>
                <td className="border-b border-graphite/40 py-3">
                  <span className="flex items-start gap-2 text-xs text-steel/80">
                    <X className="mt-0.5 size-3.5 shrink-0 text-steel/50" />
                    {r.other.text}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[0.7rem] leading-relaxed text-steel/60">
        Figures are from each product's published pricing at the time of writing. If any of it
        has changed, tell us and we will correct this page. We are not going to tell you their
        software is bad; plenty of studios run on it happily. We think the contract and the
        add-on pricing are the wrong shape for a room that has quiet months.
      </p>

      {/* The migration guarantee, stated where the decision is made. */}
      <section className="mt-12 rounded-xl border border-gold/30 bg-gold/8 p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
            <Clock className="size-5" />
          </span>
          <div>
            <h2 className="font-grotesk text-lg font-bold tracking-tight text-bone">
              Free migration, live in twenty-four hours
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-steel">
              The most common reason studios stay somewhere they have outgrown is that moving
              looks like a month of evenings. So we do it. Send us your client list, your rooms
              and your rates in whatever shape they are in, including a spreadsheet or a
              screenshot, and your booking page is live the next day.
            </p>
            <ul className="mt-4 space-y-1.5 text-xs text-steel">
              {[
                "We import your clients, rooms, rates and upcoming sessions.",
                "We build your booking page and connect your Stripe.",
                "We sit on a call while you take your first real booking.",
                "If you are not live in a day, the first month is on us.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/onboard"
          className="rounded-full bg-gold px-6 py-3 font-grotesk text-sm font-bold text-gold-ink transition-opacity hover:opacity-90"
        >
          Start on Pulse
        </Link>
        <Link
          href="/studios"
          className="rounded-full border border-graphite/60 px-6 py-3 font-grotesk text-sm font-semibold text-steel transition-colors hover:border-gold hover:text-bone"
        >
          See studios already on it
        </Link>
      </div>

      <p className="mt-10 border-t border-graphite/50 pt-5 text-xs text-steel/60">
        StudioHero is a trademark of its owner. Pulse is not affiliated with, endorsed by, or
        connected to them. This page is comparative commentary on publicly listed pricing.
      </p>
    </main>
  );
}
