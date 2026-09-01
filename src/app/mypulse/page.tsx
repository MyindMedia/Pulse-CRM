import type { Metadata } from "next";
import { PlayCircle, ShieldAlert, Lock, MessageCircleQuestion } from "lucide-react";
import { isUnlocked } from "./auth";
import { lock } from "./actions";
import { UnlockForm } from "./unlock-form";
import { FeatureBrowser } from "./feature-browser";
import { SECTIONS, TOTAL_FEATURES, ROADMAP, TIERS } from "./features";
import {
  STAGES, TONE, QUESTIONS, OBJECTIONS, PITCH, PITCH_WARNING, STORY, PRICE_RULE,
} from "./sales";

/* /mypulse - the sales team's map of the product and of the call.
 *
 * A server component on purpose: the password check and the whole feature
 * list stay on the server, so a locked visitor's page source contains a
 * password box and nothing else. See auth.ts for the gate.
 *
 * Every collapsible below is a native <details>, so the page needs no
 * JavaScript to open a section. Only the feature browser ships a client
 * component, because it has a search box.
 *
 * Deliberately price-free. Plan names appear because a rep has to know what
 * unlocks a feature; no figure does, so this page can never contradict what
 * the buying page is charging this month. */

const SHARE_TITLE = "Pulse. The studio operating system.";
const SHARE_DESC =
  "Internal sales page. The whole product, the call, the questions and the objections, in one place.";

export const metadata: Metadata = {
  title: "Pulse - Sales enablement",
  description: SHARE_DESC,
  // The primary address for anything anyone shares is studiopulse.tech.
  metadataBase: new URL("https://studiopulse.tech"),
  alternates: { canonical: "/mypulse" },
  robots: { index: false, follow: false, nocache: true },
  openGraph: {
    type: "website",
    siteName: "Pulse",
    url: "https://studiopulse.tech/mypulse",
    title: SHARE_TITLE,
    description: SHARE_DESC,
  },
  twitter: { card: "summary_large_image", title: SHARE_TITLE, description: SHARE_DESC },
};

// The gate reads a cookie, so this route can never be cached at the edge.
export const dynamic = "force-dynamic";

const STATS = [
  { n: String(TOTAL_FEATURES), label: "Things it does" },
  { n: String(SECTIONS.length), label: "Groups below" },
  { n: "955", label: "Automatic checks" },
  { n: String(ROADMAP.length), label: "Not built yet" },
];

function Overline({ children, tone }: { children: React.ReactNode; tone?: "caution" }) {
  return (
    <h2 className={tone === "caution" ? "overline text-caution" : "overline text-gold"}>
      {children}
    </h2>
  );
}

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
            Every part of Pulse that is built and working today, plus how to run the call
            around it. Open a section to read it, or use the search box. Everything here is
            built and working except the list at the bottom, which is marked as not built.
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
            <Overline>The ad</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Runs 1:46 min. Watch it once before your first call, then send it to people
            ahead of a demo. It follows one studio owner through a night
            of paperwork and leaves him back at the desk making music. Everything on screen
            is the real app.
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

        {/* What it is */}
        <section className="mt-14">
          <Overline>What you are selling</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {PITCH_WARNING}
          </p>
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

        {/* The call */}
        <section className="mt-16">
          <Overline>How to run the call</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            This follows a method called NEPQ, short for Neuro-Emotional Persuasion
            Questioning. The short version: you ask questions and they talk themselves
            into it. You do not pitch or argue, and you let them name their own problem.
            Eight steps, in order.
          </p>
          <ol className="mt-5 space-y-2.5">
            {STAGES.map((s) => (
              <li
                key={s.n}
                className="flex gap-4 rounded-chrome border border-hairline bg-coal-2/60 px-4 py-4 sm:px-5"
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-gold/12 font-meta text-[11px] text-gold">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-bone">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ash">{s.goal}</p>
                  <p className="mt-2.5 border-l-2 border-gold/40 pl-3 text-sm italic leading-relaxed text-bone/90">
                    {s.say}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Tonality */}
        <section className="mt-16">
          <Overline>The way you say it</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            The words matter less than the voice they are said in. These six matter most.
          </p>
          <div className="mt-4 grid gap-px overflow-hidden rounded-chrome border border-hairline bg-hairline sm:grid-cols-2">
            {TONE.map((t) => (
              <div key={t.rule} className="bg-coal-2 px-5 py-4">
                <h3 className="text-sm font-semibold text-bone">{t.rule}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ash">{t.why}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Third-party story */}
        <section className="mt-16">
          <Overline>Tell them about another studio</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {STORY.why}
          </p>
          <p className="mt-4 rounded-chrome border border-hairline bg-coal-2/60 px-4 py-4 text-sm italic leading-relaxed text-bone/90 sm:px-5">
            {STORY.script}
          </p>
        </section>

        {/* Price rule */}
        <section className="mt-16">
          <Overline>The one rule about price</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {PRICE_RULE.rule}
          </p>
          <div className="mt-4 grid gap-px overflow-hidden rounded-chrome border border-hairline bg-hairline sm:grid-cols-2">
            {[
              { h: "If they ask what it costs too early", p: PRICE_RULE.onACall },
              { h: "If they ask you to come down", p: PRICE_RULE.onADiscount },
            ].map((b) => (
              <div key={b.h} className="bg-coal-2 px-5 py-5">
                <h3 className="font-meta text-[11px] uppercase tracking-[0.12em] text-gold">
                  {b.h}
                </h3>
                <p className="mt-2 text-sm italic leading-relaxed text-bone/90">{b.p}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Question bank */}
        <section className="mt-16">
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="size-4 text-gold" />
            <Overline>Questions to ask</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Pick two or three from each group. Ask one, then stop talking. Write down the
            words they use and give them back to them later.
          </p>
          <div className="mt-5 space-y-2.5">
            {QUESTIONS.map((g) => (
              <details
                key={g.stage}
                className="group overflow-hidden rounded-chrome border border-hairline bg-coal-2/60"
              >
                <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-3.5 transition-colors marker:content-none hover:bg-coal-3/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="text-gold transition-transform group-open:hidden">+</span>
                  <span className="hidden text-gold group-open:inline">-</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-bone">{g.stage}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-ash">
                      {g.blurb}
                    </span>
                  </span>
                  <span className="shrink-0 font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim">
                    {g.questions.length}
                  </span>
                </summary>
                <ul className="border-t border-hairline/70 px-4 py-3 sm:px-5">
                  {g.questions.map((q) => (
                    <li
                      key={q}
                      className="border-b border-hairline/30 py-2.5 text-sm leading-relaxed text-bone/90 last:border-b-0"
                    >
                      {q}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>

        {/* The three plans */}
        <section className="mt-16">
          <Overline>The three plans</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Which plan somebody needs is a question about how their studio works, not
            about what they can afford. Pro includes everything in Studio. Label includes
            everything in Pro.
          </p>
          <div className="mt-5 space-y-2.5">
            {TIERS.map((t) => (
              <div
                key={t.tier}
                className="rounded-chrome border border-hairline bg-coal-2/60 px-4 py-4 sm:px-5"
              >
                <span
                  className={
                    t.tier === "Pro"
                      ? "rounded-md border border-gold-dim/60 bg-gold/10 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-gold"
                      : t.tier === "Label"
                        ? "rounded-md border border-bone/25 bg-bone/10 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-bone"
                        : "rounded-md border border-hairline-2 bg-coal-3 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-steel"
                  }
                >
                  {t.tier}
                </span>
                <dl className="mt-3 space-y-2">
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash-dim">
                      Who it is for
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ash">{t.who}</dd>
                  </div>
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash-dim">
                      What they get
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ash">{t.gets}</dd>
                  </div>
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-gold">
                      How to tell on a call
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-bone/90">{t.tell}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mt-16">
          <Overline>Everything it does</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {TOTAL_FEATURES} things Pulse can do, in {SECTIONS.length} groups. The tag on
            each row shows the cheapest plan that includes it. Use the plan buttons when
            you already know which plan someone is on.
          </p>
          <div className="mt-6">
            <FeatureBrowser sections={SECTIONS} />
          </div>
        </section>

        {/* Objections */}
        <section className="mt-16">
          <Overline>When they push back</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Do not answer an objection. Ask three questions instead. Find out what they
            actually mean, let them work out what it is costing them, then ask whether it
            would still be a problem if it went away. The fact at the end is only for when
            they ask you a straight question.
          </p>
          <div className="mt-5 space-y-2.5">
            {OBJECTIONS.map((o) => (
              <details
                key={o.says}
                className="group overflow-hidden rounded-chrome border border-hairline bg-coal-2/60"
              >
                <summary className="cursor-pointer list-none px-4 py-3.5 text-sm font-medium text-bone transition-colors marker:content-none hover:bg-coal-3/40 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="mr-2 text-gold transition-transform group-open:hidden">+</span>
                  <span className="mr-2 hidden text-gold group-open:inline">-</span>
                  &quot;{o.says}&quot;
                </summary>
                <div className="space-y-3 border-t border-hairline/70 px-4 py-4 sm:px-5">
                  {[
                    { k: "1. Clarify", v: o.clarify },
                    { k: "2. Discuss", v: o.discuss },
                    { k: "3. Diffuse", v: o.diffuse },
                  ].map((step) => (
                    <div key={step.k}>
                      <p className="font-meta text-[10px] uppercase tracking-[0.12em] text-gold">
                        {step.k}
                      </p>
                      <p className="mt-1 border-l-2 border-gold/30 pl-3 text-sm italic leading-relaxed text-bone/90">
                        {step.v}
                      </p>
                    </div>
                  ))}
                  {o.fact && (
                    <div className="rounded-lg bg-ink/60 px-3 py-2.5">
                      <p className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash-dim">
                        Only if they ask
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ash">{o.fact}</p>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Roadmap */}
        <section className="mt-16">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-caution" />
            <Overline tone="caution">Not built yet. Never sell these as if they work.</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            These are on the list but they do not exist. They are here so you can answer
            honestly and still sound like you know where Pulse is going. If somebody needs
            one of them to sign, say it is on the list and then tell us. Never give a date.
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
                    <span className="text-bone">Why it would matter: </span>
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
            {TOTAL_FEATURES} built · {ROADMAP.length} not built
          </span>
        </footer>
      </div>
    </main>
  );
}
