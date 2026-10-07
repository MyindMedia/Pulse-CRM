import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Minus, Phone01, Plus, Server01 } from "@untitledui/icons";
import { PRICING, TIERS, formatUsd } from "@convex/lib/pricing";
import { LandingNav } from "@/components/marketing/landing-nav";
import { Footer } from "@/components/marketing/footer";
import { PULSE_IOS_APP_URL } from "@/components/marketing/app-store";
import { accessRows, pooledTiers } from "@/components/marketing/plan-facts";
import {
  SITE_KEYWORDS,
  jsonLdHtml,
  mobileApplicationJsonLd,
  softwareApplicationJsonLd,
} from "@/components/marketing/structured-data";
import { PricingPlans } from "./plans";
import {
  DEMO_HREF,
  R2_LINE,
  R2_PER_ORG_LIVE,
  TERMS,
  appTiers,
  comparisonGroups,
  faqs,
  includesLine,
  planCards,
} from "./model";

/* studiopulse.tech/pricing: the public price page.

   Everything on it is rendered from convex/lib/pricing.ts through ./model.ts:
   the cards, the comparison table, the allowances, the app section, the FAQ
   numbers and the JSON-LD offers. Nothing here names a rival, quotes a sales
   note, or lists a feature that is not built. Stays dark in both themes
   (theme-dark-island) so the gold accent always reads. */

const PRICE_LINE = TIERS.map(
  (t) => `${PRICING[t].name} ${formatUsd(PRICING[t].monthlyCents)}/mo`,
).join(", ");

const TITLE = "Pricing: Core, Growth and Max | Pulse OS for recording studios";
const DESCRIPTION = `Pulse OS plans for recording and music studios. ${PRICE_LINE}, with unlimited studios on Max at one flat price. Month to month, no per-seat fees, no booking commission.`;
const SHARE_TITLE = "Pulse OS pricing. Core, Growth and Max.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: SITE_KEYWORDS,
  alternates: { canonical: "/pricing" },
  // The images come from ./opengraph-image.tsx and ./twitter-image.tsx, so
  // this override still carries the social card.
  openGraph: {
    type: "website",
    siteName: "Pulse",
    url: "/pricing",
    title: SHARE_TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SHARE_TITLE, description: DESCRIPTION },
};

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

function SectionHead({ over, title, children }: { over: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="chrome-meta text-gold">{over}</p>
      <h2 className="chrome-display chrome-fill mt-3 text-[2rem] sm:text-5xl">{title}</h2>
      {children && (
        <p className="font-grotesk mt-4 text-base leading-relaxed text-mist">{children}</p>
      )}
    </div>
  );
}

export default function PricingPage() {
  const cards = planCards();
  const groups = comparisonGroups();
  const access = accessRows();
  const pooled = pooledTiers();
  const app = appTiers();
  const questions = faqs();

  return (
    <div className="theme-dark-island relative min-h-dvh overflow-x-hidden bg-ink text-bone">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(softwareApplicationJsonLd()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(mobileApplicationJsonLd()) }}
      />
      <LandingNav />

      <main className="px-4 pb-24 pt-32 sm:pt-36 lg:px-8">
        {/* Hero */}
        <section className="mx-auto max-w-3xl text-center">
          <p className="chrome-meta text-gold">Pulse OS pricing</p>
          <h1 className="chrome-display chrome-fill mt-4 text-[2.5rem] leading-[1.05] sm:text-6xl">
            One studio operating system. Three plans.
          </h1>
          <p className="font-grotesk mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-mist">
            Pick the plan that matches how your studio works. {includesLine()} Max covers
            unlimited studios at one flat price.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link prefetch={false}
              href={DEMO_HREF}
              className={`group inline-flex items-center gap-2 rounded-chrome bg-gold px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright ${focusRing}`}
            >
              Book a demo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href="#compare"
              className={`chrome-ghost chrome-ghost-gold inline-flex items-center rounded-chrome px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-mist transition-colors hover:text-gold ${focusRing}`}
            >
              Compare every feature
            </a>
          </div>
          <ul className="mx-auto mt-8 flex max-w-2xl flex-col gap-2 text-left sm:items-center sm:text-center">
            {TERMS.map((t) => (
              <li key={t} className="font-grotesk flex items-start gap-2 text-sm text-mist sm:items-center">
                <Check className="mt-0.5 size-4 shrink-0 text-gold sm:mt-0" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Plans */}
        <section aria-labelledby="plans-title" className="mx-auto mt-16 max-w-6xl">
          <h2 id="plans-title" className="sr-only">
            Plans and prices
          </h2>
          <PricingPlans cards={cards} />
        </section>

        {/* Access and allowances */}
        <section aria-labelledby="access-title" className="mx-auto mt-24 max-w-5xl">
          <SectionHead over="What each plan includes" title="Rooms, roles and allowances">
            Every plan is priced by features, never per login.
            {pooled.length > 0 &&
              ` On ${pooled.map((t) => PRICING[t].name).join(" and ")}, allowances are shared across all your studios.`}
          </SectionHead>
          <h3 id="access-title" className="sr-only">
            Allowances by plan
          </h3>
          <div
            className="mt-10 overflow-x-auto rounded-chrome border border-hairline-2"
            tabIndex={0}
            role="region"
            aria-label="Allowances by plan, scrolls sideways on small screens"
          >
            <table className="w-full min-w-[560px] border-collapse text-left font-grotesk text-sm">
              <thead>
                <tr className="bg-coal-2">
                  <th scope="col" className="px-4 py-3 font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel">
                    <span className="sr-only">Allowance</span>
                  </th>
                  {TIERS.map((t) => (
                    <th
                      key={t}
                      scope="col"
                      className={`px-4 py-3 font-semibold ${PRICING[t].highlight ? "text-gold" : "text-bone"}`}
                    >
                      {PRICING[t].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {access.map((row) => (
                  <tr key={row.label} className="border-t border-hairline">
                    <th scope="row" className="px-4 py-3 font-medium text-mist">
                      {row.label}
                    </th>
                    {TIERS.map((t) => (
                      <td key={t} className="px-4 py-3 text-bone">
                        {row.values[t]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Comparison */}
        <section id="compare" aria-labelledby="compare-title" className="mx-auto mt-24 max-w-5xl scroll-mt-24">
          <SectionHead over="Compare plans" title="Everything Pulse does">
            Every feature below is built and working today. A check means the plan includes it.
          </SectionHead>
          <h3 id="compare-title" className="sr-only">
            Feature comparison by plan
          </h3>
          <div className="mt-10 space-y-3">
            {groups.map((g, gi) => (
              <details
                key={g.id}
                open={gi === 0}
                className="group overflow-hidden rounded-chrome border border-hairline-2 bg-coal/70 open:border-gold/40"
              >
                <summary
                  className={`flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden ${focusRing}`}
                >
                  <span className="font-grotesk text-base font-semibold text-bone">
                    {g.title}
                    <span className="ml-2 font-meta text-xs font-normal uppercase tracking-[0.06em] text-steel">
                      {g.rows.length} {g.rows.length === 1 ? "feature" : "features"}
                    </span>
                  </span>
                  <ChevronDown
                    className="size-5 shrink-0 text-gold transition-transform duration-200 group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <table className="w-full table-fixed border-collapse text-left font-grotesk text-sm">
                  <caption className="sr-only">{g.title}, by plan</caption>
                  <thead>
                    <tr className="border-t border-hairline bg-coal-2">
                      <th scope="col" className="px-4 py-2.5 font-meta text-xs font-medium uppercase tracking-[0.06em] text-steel sm:px-5">
                        Feature
                      </th>
                      {TIERS.map((t) => (
                        <th
                          key={t}
                          scope="col"
                          className={`w-16 px-1 py-2.5 text-center text-xs font-semibold sm:w-28 sm:text-sm ${PRICING[t].highlight ? "text-gold" : "text-bone"}`}
                        >
                          {PRICING[t].name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, ri) => (
                      <tr key={`${r.name}-${ri}`} className="border-t border-hairline/70">
                        <th scope="row" className="px-4 py-3 font-normal text-bone sm:px-5">
                          {r.name}
                        </th>
                        {TIERS.map((t) => (
                          <td key={t} className="px-1 py-3 text-center">
                            {r.included[t] ? (
                              <>
                                <Check className="mx-auto size-5 text-gold" aria-hidden />
                                <span className="sr-only">Included</span>
                              </>
                            ) : (
                              <>
                                <Minus className="mx-auto size-4 text-slate" aria-hidden />
                                <span className="sr-only">Not included</span>
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        </section>

        {/* The Pulse app */}
        <section aria-labelledby="app-title" className="mx-auto mt-24 max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="chrome-meta inline-flex items-center gap-2 text-gold">
              <Phone01 className="size-4" aria-hidden />
              The Pulse app
            </p>
            <h2 id="app-title" className="chrome-display chrome-fill mt-3 text-[2rem] sm:text-5xl">
              Run your studio from your phone with the Pulse app for iPhone
            </h2>
            <p className="font-grotesk mt-4 text-base leading-relaxed text-mist">
              The app is free to download and signs in to the same studio you use on the web.
              Here is what it does on each plan.
            </p>
          </div>
          <ul className="mt-10 grid gap-4 md:grid-cols-3">
            {app.map((a) => (
              <li key={a.tier} className="rounded-chrome border border-hairline-2 bg-coal/70 p-5">
                <h3 className="font-grotesk text-lg font-semibold text-bone">{a.name}</h3>
                {a.lead && <p className="chrome-meta mt-3 text-steel">{a.lead}</p>}
                <ul className="mt-3 space-y-2">
                  {a.items.map((item) => (
                    <li key={item} className="font-grotesk flex items-start gap-2.5 text-sm text-mist">
                      <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex justify-center">
            <a
              href={PULSE_IOS_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`chrome-ghost chrome-ghost-gold inline-flex items-center gap-2 rounded-chrome px-6 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold transition-colors hover:text-gold-bright ${focusRing}`}
            >
              Get the Pulse app on the App Store
              <ArrowRight className="size-4" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </section>

        {/* Infrastructure: off until R2_PER_ORG_LIVE is flipped in ./model.ts */}
        {R2_PER_ORG_LIVE && (
          <section aria-label="Infrastructure" className="mx-auto mt-16 max-w-3xl">
            <p className="font-grotesk flex items-start justify-center gap-3 rounded-chrome border border-hairline-2 bg-coal/70 px-5 py-4 text-sm text-mist">
              <Server01 className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
              <span>{R2_LINE}</span>
            </p>
          </section>
        )}

        {/* FAQ */}
        <section aria-labelledby="faq-title" className="mx-auto mt-24 max-w-3xl">
          <div className="text-center">
            <p className="chrome-meta text-gold">Questions</p>
            <h2 id="faq-title" className="chrome-display chrome-fill mt-3 text-[2rem] sm:text-5xl">
              Pricing, answered
            </h2>
          </div>
          <div className="mt-10 space-y-3">
            {questions.map((f) => (
              <details
                key={f.q}
                className="group rounded-chrome border border-hairline-2 bg-coal/70 transition-colors open:border-gold/50"
              >
                <summary
                  className={`font-grotesk flex cursor-pointer list-none items-center justify-between gap-4 rounded-chrome p-5 text-left text-base font-semibold text-bone [&::-webkit-details-marker]:hidden ${focusRing}`}
                >
                  {f.q}
                  <Plus className="size-4 shrink-0 text-gold transition-transform duration-300 group-open:rotate-45" aria-hidden />
                </summary>
                <p className="font-grotesk px-5 pb-5 text-sm leading-relaxed text-mist">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing call to action */}
        <section className="mx-auto mt-24 max-w-3xl rounded-chrome border border-gold/40 bg-coal px-6 py-10 text-center sm:px-10">
          <h2 className="chrome-display chrome-fill text-[2rem] sm:text-4xl">See it on your own studio</h2>
          <p className="font-grotesk mx-auto mt-4 max-w-xl text-base leading-relaxed text-mist">
            Book a 30 minute demo. We will show you Pulse with your rooms and your prices, and
            move your data over for free when you are ready.
          </p>
          <Link prefetch={false}
            href={DEMO_HREF}
            className={`mt-7 inline-flex items-center gap-2 rounded-chrome bg-gold px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright ${focusRing}`}
          >
            Book a demo
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </section>
      </main>

      <Footer />
    </div>
  );
}
