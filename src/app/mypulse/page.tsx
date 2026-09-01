import type { Metadata } from "next";
import { PlayCircle, ShieldAlert, Lock } from "lucide-react";
import { isUnlocked } from "./auth";
import { lock } from "./actions";
import { UnlockForm } from "./unlock-form";
import { FeatureBrowser } from "./feature-browser";
import { SECTIONS, TOTAL_FEATURES, ROADMAP } from "./features";

/* /mypulse - the sales team's map of the product.
 *
 * A server component on purpose: the password check and the whole feature
 * list stay on the server, so a locked visitor's page source contains a
 * password box and nothing else. See auth.ts for the gate.
 *
 * Deliberately price-free. Plan names appear because a rep has to know what
 * unlocks a feature; no figure does, so this page can never contradict what
 * the buying page is charging this month. */

export const metadata: Metadata = {
  title: "Pulse · Sales enablement",
  description: "Internal product map for the Pulse sales team.",
  robots: { index: false, follow: false, nocache: true },
};

// The gate reads a cookie, so this route can never be cached at the edge.
export const dynamic = "force-dynamic";

const STATS = [
  { n: String(TOTAL_FEATURES), label: "Shipped features" },
  { n: String(SECTIONS.length), label: "Product areas" },
  { n: "82", label: "Data tables" },
  { n: "955", label: "Automated tests" },
];

const PITCH = [
  {
    h: "In one line",
    p: "Pulse is the operating system for recording studios. Bookings, money, staff, gear and the music itself in one place, with an AI ops manager reading the studio's real data and waiting for a yes.",
  },
  {
    h: "The wedge",
    p: "Start with the booking page. A client picks a room, picks a time and pays a deposit into the studio's own Stripe, at one in the morning, with nobody awake. That is the demo that gets a second call.",
  },
  {
    h: "The line that lands",
    p: "Studios on Pulse do not work more hours. They book more of them.",
  },
  {
    h: "Who buys it",
    p: "Independent studio owners with twenty to two hundred clients a year; producer and engineer teams juggling handoffs; boutique labels and multi-room operators who need one console over several studios.",
  },
];

const OBJECTIONS = [
  {
    q: "We already run on a calendar and a spreadsheet.",
    a: "So does the studio that loses a Saturday night to a no-show and never charges for it. Ask what a cancelled session costs them, then show deposit forfeit and the automatic waitlist refill. The spreadsheet cannot take money.",
  },
  {
    q: "Switching sounds like months of work.",
    a: "Free white-glove migration, and the studio is taking bookings the same day. Client list comes in from CSV, gear comes in from their existing spreadsheet, and onboarding is resumable, so nothing has to finish before the first booking.",
  },
  {
    q: "Does Pulse hold our money?",
    a: "Never. Each studio connects its own Stripe account and gets paid directly. Pulse facilitates the checkout and records the ledger.",
  },
  {
    q: "Is the AI going to email my clients on its own?",
    a: "No. Nothing client-facing or financial goes out without an explicit approval. Low-risk reminders can be switched to run themselves, by the owner, and nothing else can.",
  },
  {
    q: "We are one room. This looks like too much.",
    a: "They only ever see what they switched on. Sell them the booking page and no-show recovery. Staff scheduling, patchbay and splits are there the day the second room opens, not a migration later.",
  },
  {
    q: "Are we locked into a contract?",
    a: "Month to month. Cancel any time, everything is in the plan, and there are no add-on charges for the things competitors bill separately, like calendar sync.",
  },
];

export default async function MyPulsePage() {
  if (!(await isUnlocked())) return <UnlockForm />;

  return (
    <main className="min-h-dvh bg-ink">
      <div className="mx-auto max-w-4xl px-5 pb-24 pt-8 sm:px-6">
        <header className="flex items-center justify-between gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pulse-logo-main.png" alt="Pulse" className="h-5 w-auto" />
          <form action={lock}>
            <button
              type="submit"
              className="flex items-center gap-1.5 font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim transition-colors hover:text-gold"
            >
              <Lock className="size-3" />
              Lock this page
            </button>
          </form>
        </header>

        {/* Hero */}
        <section className="mt-12">
          <p className="overline text-gold">Internal · Sales enablement</p>
          <h1 className="chrome-display chrome-fill mt-3 text-[2.6rem] leading-[1.05] sm:text-[3.6rem]">
            Everything Pulse
            <br />
            actually does
          </h1>
          <p className="mt-5 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            The whole surface of the product, shipped and running, grouped the way a
            conversation goes rather than the way the codebase is organized. Open a
            section, or search it. Nothing on this page is aspirational except the
            roadmap at the bottom, which says so.
          </p>

          <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-chrome border border-hairline bg-hairline sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-coal-2 px-4 py-4">
                <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash-dim">
                  {s.label}
                </dt>
                <dd className="mt-1 text-2xl font-bold tracking-tight text-bone">{s.n}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The commercial */}
        <section className="mt-14">
          <div className="flex items-center gap-2">
            <PlayCircle className="size-4 text-gold" />
            <h2 className="overline text-gold">The commercial</h2>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            One minute forty-six. Watch it once before your first call, then send it
            ahead of a demo. It runs the whole story through one studio owner: buried in
            admin at midnight, back behind the console by the end. Every beat in it is
            real product, not a mockup.
          </p>
          <div className="mt-5 overflow-hidden rounded-chrome border border-hairline bg-black shadow-card">
            <video
              className="block aspect-video w-full"
              controls
              playsInline
              preload="metadata"
              poster="/pulse-commercial-poster.jpg"
            >
              <source src="/pulse-commercial.mp4" type="video/mp4" />
              Your browser cannot play this video. Download it at{" "}
              <a href="/pulse-commercial.mp4">/pulse-commercial.mp4</a>.
            </video>
          </div>
          <p className="mt-2.5 font-meta text-[11px] uppercase tracking-[0.1em] text-ash-dim">
            Pulse · The studio that runs itself · 1:46 · 16:9
          </p>
        </section>

        {/* Talk track */}
        <section className="mt-14">
          <h2 className="overline text-gold">How to open</h2>
          <div className="mt-4 grid gap-px overflow-hidden rounded-chrome border border-hairline bg-hairline sm:grid-cols-2">
            {PITCH.map((b) => (
              <div key={b.h} className="bg-coal-2 px-5 py-5">
                <h3 className="font-meta text-[11px] uppercase tracking-[0.12em] text-gold">
                  {b.h}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ash">{b.p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mt-14">
          <h2 className="overline text-gold">The feature map</h2>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {TOTAL_FEATURES} shipped capabilities across {SECTIONS.length} areas. The plan
            chip on each row is what unlocks it, and each plan contains every plan beneath
            it. Filter by plan when a prospect has already told you which one they are.
          </p>
          <div className="mt-6">
            <FeatureBrowser sections={SECTIONS} />
          </div>
        </section>

        {/* Objections */}
        <section className="mt-16">
          <h2 className="overline text-gold">When they push back</h2>
          <div className="mt-4 space-y-2.5">
            {OBJECTIONS.map((o) => (
              <details
                key={o.q}
                className="group overflow-hidden rounded-chrome border border-hairline bg-coal-2/60"
              >
                <summary className="cursor-pointer list-none px-4 py-3.5 text-sm font-medium text-bone transition-colors marker:content-none hover:bg-coal-3/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="mr-2 text-gold transition-transform group-open:hidden">+</span>
                  <span className="mr-2 hidden text-gold group-open:inline">-</span>
                  {o.q}
                </summary>
                <p className="border-t border-hairline/70 px-4 py-3.5 text-sm leading-relaxed text-ash sm:px-5">
                  {o.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Roadmap */}
        <section className="mt-16">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-caution" />
            <h2 className="overline text-caution">Not built yet · never sell as live</h2>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Here so you can answer honestly and still sound like you know where the
            product is going. If a prospect needs one of these to sign, say it is on the
            roadmap and bring it back to us. Do not put a date on it.
          </p>
          <div className="mt-5 space-y-2.5">
            {ROADMAP.map((r) => (
              <details
                key={r.title}
                className="group overflow-hidden rounded-chrome border border-caution/25 bg-coal-2/50"
              >
                <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-3.5 transition-colors marker:content-none hover:bg-coal-3/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="shrink-0 rounded-md border border-caution/30 bg-caution/10 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-caution">
                    {r.kind}
                  </span>
                  <span className="text-sm font-medium text-bone">{r.title}</span>
                </summary>
                <div className="space-y-2 border-t border-hairline/70 px-4 py-3.5 sm:px-5">
                  <p className="text-sm leading-relaxed text-ash">{r.what}</p>
                  <p className="text-sm leading-relaxed text-ash-dim">
                    <span className="text-bone">Why it matters: </span>
                    {r.why}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
          <span className="font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim">
            Pulse · ThaMyind · studiopulse.tech
          </span>
          <span className="font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim">
            {TOTAL_FEATURES} shipped · {ROADMAP.length} on the board
          </span>
        </footer>
      </div>
    </main>
  );
}
