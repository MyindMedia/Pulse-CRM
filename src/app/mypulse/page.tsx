import type { Metadata } from "next";
import { PlayCircle, AlertTriangle, Lock01, Phone01 } from "@untitledui/icons";
import { TIERS, type TierKey } from "@convex/lib/pricing";
import { isUnlocked } from "./auth";
import { lock } from "./actions";
import { UnlockForm } from "./unlock-form";
import { FeatureBrowser } from "./feature-browser";
import {
  MOVED_COUNT,
  ROADMAP,
  SECTIONS,
  TIERS_GUIDE,
  TIER_TOTALS,
  TOTAL_FEATURES,
  tierName,
} from "./features";
import { accessRows, priceRows, pooledTiers, type FactRow } from "@/components/marketing/plan-facts";
import { includesLine } from "../pricing/model";
import { siteMedia } from "@/lib/media";

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
 * Every plan name, price, allowance and feature tag is read from
 * convex/lib/pricing.ts (through ./features.ts and plan-facts.ts), the same
 * config /pricing renders from, so the two pages can never disagree. */

const SHARE_TITLE = "Pulse. The studio operating system.";
const SHARE_DESC =
  "Internal fact sheet. Everything Pulse does today, in plain words, with the plan that unlocks each part.";

export const metadata: Metadata = {
  title: "Sales enablement | Pulse",
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

/* Every figure here is counted from the config. (The old "955 automatic
   checks" tile is gone: the test count is not in the config, so it could not
   be kept true.) */
const STATS = [
  { n: String(TOTAL_FEATURES), label: "Things it does" },
  { n: String(SECTIONS.length), label: "Groups below" },
  { n: TIERS.map((t) => TIER_TOTALS[t]).join(" / "), label: TIERS.map(tierName).join(" / ") },
  { n: String(ROADMAP.length), label: "Not built yet" },
];

const TIER_BADGE: Record<TierKey, string> = {
  core: "rounded-md border border-hairline-2 bg-coal-3 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-steel",
  growth: "rounded-md border border-gold-dim/60 bg-gold/10 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-gold",
  max: "rounded-md border border-bone/25 bg-bone/10 px-1.5 py-0.5 font-meta text-[10px] uppercase tracking-[0.1em] text-bone",
};

function FactTable({ rows, caption }: { rows: FactRow[]; caption: string }) {
  return (
    <div
      className="overflow-x-auto rounded-chrome border border-hairline"
      tabIndex={0}
      role="region"
      aria-label={`${caption}, scrolls sideways on small screens`}
    >
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-coal-2">
            <th scope="col" className="px-4 py-2.5">
              <span className="sr-only">Item</span>
            </th>
            {TIERS.map((t) => (
              <th key={t} scope="col" className="px-4 py-2.5 font-semibold text-bone">
                {tierName(t)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-hairline/70">
              <th scope="row" className="px-4 py-2.5 font-medium text-ash">
                {r.label}
              </th>
              {TIERS.map((t) => (
                <td key={t} className="px-4 py-2.5 text-bone">
                  {r.values[t]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
              className="flex items-center gap-1.5 font-meta text-[11px] uppercase tracking-[0.12em] text-ash transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <Lock01 className="size-3" aria-hidden />
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
            does today
          </h1>
          <p className="mt-5 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Every part of Pulse that is built and working today, in plain words. The words
            you sell it with are yours to write. Open a section to read it, or use the search
            box. The one exception is the list at the bottom, which is marked as not built.
          </p>

          <dl className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-chrome border border-hairline bg-hairline sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="bg-coal-2 px-4 py-4">
                <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash">
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
            <PlayCircle className="size-4 text-gold" aria-hidden />
            <Overline>The ad</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Runs 1:46 min. It follows one studio owner through a night of paperwork and
            leaves him back at the desk making music. Everything on screen is the real app.
          </p>
          <div className="mt-5 overflow-hidden rounded-chrome border border-hairline bg-black shadow-card">
            <video
              className="block aspect-video w-full"
              controls
              playsInline
              preload="metadata"
              poster="/pulse-commercial-poster.jpg"
            >
              <source src={siteMedia("/pulse-commercial.mp4")} type="video/mp4" />
              Your browser cannot play this video. Download it at{" "}
              <a href={siteMedia("/pulse-commercial.mp4")}>pulse-commercial.mp4</a>.
            </video>
          </div>
          <p className="mt-2.5 font-meta text-[11px] uppercase tracking-[0.1em] text-ash-dim">
            Pulse · The studio that runs itself · 1:46 · 16:9
          </p>
        </section>

        {/* The three plans */}
        <section className="mt-16">
          <Overline>The three plans</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Which plan somebody needs is a question about how their studio works, not
            about what they can afford. {includesLine()}
          </p>
          <div className="mt-5 space-y-2.5">
            {TIERS_GUIDE.map((t) => (
              <div
                key={t.tier}
                className="rounded-chrome border border-hairline bg-coal-2/60 px-4 py-4 sm:px-5"
              >
                <span className={TIER_BADGE[t.tier]}>{t.name}</span>
                <dl className="mt-3 space-y-2">
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash">
                      Who it is for
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ash">{t.who}</dd>
                  </div>
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash">
                      What they get
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ash">{t.gets}</dd>
                  </div>
                  <div>
                    <dt className="font-meta text-[10px] uppercase tracking-[0.12em] text-ash">
                      Access
                    </dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ash">
                      <ul className="list-disc space-y-0.5 pl-4">
                        {t.access.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </dd>
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
          <p className="mt-3 text-sm text-ash">
            {MOVED_COUNT} features moved to a cheaper plan in this ladder. They carry a
            Moved down tag in the list below.
          </p>
        </section>

        {/* Prices */}
        <section className="mt-16">
          <Overline>Prices</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Month to month, or yearly with the months free shown below. Max is one flat
            price for unlimited studios, with no charge per studio.
          </p>
          <div className="mt-5">
            <FactTable rows={priceRows()} caption="Prices by plan" />
          </div>
        </section>

        {/* Access and allowances */}
        <section className="mt-16">
          <Overline>Who gets in, and how much they get</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            Roles, rooms, studios and allowances on each plan. Plans are priced by
            features, never per login.
            {pooledTiers().length > 0 &&
              ` On ${pooledTiers().map(tierName).join(" and ")}, allowances are shared across every studio in the group.`}
          </p>
          <div className="mt-5">
            <FactTable rows={accessRows()} caption="Access and allowances by plan" />
          </div>
        </section>

        {/* The Pulse app */}
        <section className="mt-16">
          <div className="flex items-center gap-2">
            <Phone01 className="size-4 text-gold" aria-hidden />
            <Overline>The Pulse app on each plan</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            What the iPhone app does today. Say this on the web and on calls only: the
            app itself never shows plan names or prices.
          </p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            {TIERS_GUIDE.map((t, i) => (
              <div key={t.tier} className="rounded-chrome border border-hairline bg-coal-2/60 px-4 py-4">
                <span className={TIER_BADGE[t.tier]}>{t.name}</span>
                {i > 0 && (
                  <p className="mt-2 text-xs text-ash">
                    Everything in {TIERS_GUIDE[i - 1].name}, plus
                  </p>
                )}
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ash">
                  {t.app.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mt-16">
          <Overline>Everything it does</Overline>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            {TOTAL_FEATURES} things Pulse can do, in {SECTIONS.length} groups. The tag on
            each row shows the cheapest plan that includes it. {includesLine()} Use the
            plan buttons when you already know which plan someone is on.
          </p>
          <div className="mt-6">
            <FeatureBrowser sections={SECTIONS} />
          </div>
        </section>

        {/* Roadmap */}
        <section className="mt-16">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-caution" aria-hidden />
            <Overline tone="caution">Not built yet</Overline>
          </div>
          <p className="mt-3 max-w-2xl text-[0.975rem] leading-relaxed text-ash">
            These are on the list and not built. They are here so nobody describes them
            as working. If a customer needs one, tell us, and never give anyone a date.
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
          <span className="font-meta text-[11px] uppercase tracking-[0.12em] text-ash">
            Pulse · ThaMyind · studiopulse.tech
          </span>
          <span className="font-meta text-[11px] uppercase tracking-[0.12em] text-ash">
            {TOTAL_FEATURES} built · {ROADMAP.length} not built
          </span>
        </footer>
      </div>
    </main>
  );
}
