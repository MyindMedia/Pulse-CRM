import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Cable, Clock, ListChecks, Receipt, Users, type LucideIcon } from "lucide-react";
import { DownloadBlock } from "@/components/marketing/download-block";
import { APP_STORE_URL } from "@/components/marketing/app-store";
import { StudioMockup } from "@/components/marketing/studio-mockup";

/* studiopulse.tech/mobile - the download page for My Studio Pulse, the iPhone
 * app for studios that run on Pulse.
 *
 * Says nothing about what Pulse costs. The iPhone app is free and sells
 * nothing, which is the whole basis of the 3.1.3(f) companion-app case made to
 * App Review; a price on the page that fronts the download is the last place
 * that argument should spring a leak. Studios are onboarded by invitation, so
 * the only call to action here is "get the app", never "buy".
 *
 * Search: the <title> is keyword-shaped like the site root ("Pulse: Recording
 * Studio Management Software"), the h1 and h2s carry "studio" and "iPhone" in
 * plain sentences, and a SoftwareApplication record tells Google this is a
 * free iOS app with its App Store link. The App Store page itself carries the
 * screenshots, so none are repeated here. */

const SITE_URL = "https://studiopulse.tech";
const TITLE = "My Studio Pulse: Recording Studio App for iPhone";
const DESCRIPTION =
  "Free iPhone app for recording studios on Pulse: your team clocks in from the Lock Screen and runs today's sessions; you see balances, receipts and the P&L. On the App Store.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/mobile" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/mobile",
    type: "website",
    siteName: "Pulse",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/* Structured data for the app itself. Price 0 is a fact the copy also states;
   nothing here names a plan or a tier. */
const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "My Studio Pulse",
  applicationCategory: "BusinessApplication",
  operatingSystem: "iOS 17 or later",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  installUrl: APP_STORE_URL,
  url: `${SITE_URL}/mobile`,
  description: DESCRIPTION,
  publisher: { "@type": "Organization", name: "Pulse", url: SITE_URL },
};

type Capability = { icon: LucideIcon; label: string; note: string };

/* What the app does, in the order a studio meets it: the shift, the day, the
   room, the money, the people. Every line is a screen that exists. */
const CAPABILITIES: Capability[] = [
  {
    icon: Clock,
    label: "Today",
    note: "Your team clocks in and out with one tap. The running shift shows on their Lock Screen and in the Dynamic Island, and you see who is actually in.",
  },
  {
    icon: CalendarDays,
    label: "Schedule",
    note: "Seven days of studio sessions across every room. Confirm, reschedule, extend or assign an engineer from the session itself.",
  },
  {
    icon: ListChecks,
    label: "Prep",
    note: "Arrival prep and session checklists, so the room is ready before the client walks in and closed out properly after they leave.",
  },
  {
    icon: Cable,
    label: "Patch",
    note: "Every connection in every room: what is plugged into what, and how. When an engineer re-patches or moves a cable, they log it from the phone, so you always have the current wiring and a record of every change.",
  },
  {
    icon: Receipt,
    label: "Money",
    note: "Bank balances next to what is due today, invoices and payments. Snap a receipt and Pulse reads it and matches it to the bank transaction and the expense; the profit and loss report is built from the same figures.",
  },
  {
    icon: Users,
    label: "Team",
    note: "Who is rostered, who is actually clocked in, and who has not turned up yet.",
  },
];

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-l border-hairline pl-4">
      <dt className="font-meta text-[0.625rem] uppercase tracking-[0.14em] text-slate">{k}</dt>
      <dd className="text-sm text-mist">{v}</dd>
    </div>
  );
}

export default function IosPage() {
  return (
    <main className="bg-ink text-bone">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_JSON_LD).replace(/</g, "\\u003c") }}
      />

      {/* ---------- Hero ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col items-start gap-7">
            <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-gold">
              My Studio Pulse &middot; Now on the App Store
            </p>

            {/* chrome-display is the site's Anton setting. Its caps are nearly a
                full em tall, so the tight hand-rolled leading this page used to
                carry made the lines collide; 1.06 keeps a clear gap without
                opening the block up into three separate words. */}
            <h1
              className="chrome-display max-w-[14ch] text-balance text-[clamp(2.6rem,6vw,4.25rem)] text-bone"
              style={{ lineHeight: 1.06 }}
            >
              Run the studio from your iPhone
            </h1>

            <p className="max-w-[46ch] text-base leading-relaxed text-steel sm:text-lg">
              My Studio Pulse is the free iPhone app for recording studios that run on Pulse.
              Your team clocks in from the Lock Screen, works today&rsquo;s sessions and preps the
              room from their pockets. You see who is in, what each client owes and the money as it
              moves, on the same accounts you use on the web.
            </p>

            <DownloadBlock />

            <dl className="mt-2 grid w-full grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              <Spec k="Price" v="Free" />
              <Spec k="Requires" v="iOS 17 or later" />
              <Spec k="Built for" v="iPhone" />
              <Spec k="Offline" v="Keeps working, syncs later" />
            </dl>
          </div>

          <div className="relative w-full">
            <StudioMockup priority />
            <p className="mt-4 font-meta text-[0.625rem] uppercase tracking-[0.14em] text-slate">
              The shipping app, recorded on an iPhone
            </p>
          </div>
        </div>
      </section>

      {/* ---------- What it does ---------- */}
      <section className="border-t border-hairline bg-ink-2">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
          <header className="flex max-w-2xl flex-col gap-4">
            <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-slate">
              What it does
            </p>
            <h2 className="chrome-display text-balance text-4xl text-bone sm:text-5xl">
              The studio day, from clock-in to P&amp;L
            </h2>
            <p className="text-sm leading-relaxed text-steel">
              It is the same studio workspace as the web app, with the same permissions: an
              engineer sees the session, an owner also sees the money.
            </p>
          </header>

          <dl className="mt-12 grid gap-x-14 sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, label, note }) => (
              <div
                key={label}
                className="flex gap-5 border-t border-hairline py-7 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-gold" strokeWidth={1.5} aria-hidden />
                <div className="flex flex-col gap-1.5">
                  <dt className="font-meta text-[0.6875rem] uppercase tracking-[0.16em] text-bone">
                    {label}
                  </dt>
                  <dd className="text-sm leading-relaxed text-steel">{note}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------- Access ---------- */}
      <section className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-20 sm:py-24 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-xl flex-col gap-5">
            <h2 className="chrome-display text-balance text-4xl text-bone sm:text-5xl">
              You need a studio account first
            </h2>
            <p className="text-sm leading-relaxed text-steel">
              The app signs you in to your studio&rsquo;s workspace, so there has to be one. An
              owner or manager invites you from the web app, and the invitation links your login to
              your seat on the team. If your studio already runs Pulse, ask whoever set it up for
              an invite, then come back and download the app.
            </p>
            <p className="text-sm leading-relaxed text-steel">
              Not on Pulse yet?{" "}
              <Link href="/" className="text-gold underline-offset-4 hover:underline">
                See what Pulse does
              </Link>
              , or{" "}
              <Link href="/support" className="text-gold underline-offset-4 hover:underline">
                talk to us
              </Link>{" "}
              and we will get your studio set up.
            </p>
          </div>

          <div className="flex shrink-0 flex-col gap-5 rounded-2xl border border-hairline bg-coal p-7">
            <p className="font-meta text-[0.625rem] uppercase tracking-[0.16em] text-slate">
              Get the app
            </p>
            <DownloadBlock compact />
            <p className="max-w-[34ch] text-xs leading-relaxed text-slate">
              Nothing is sold in the app. It opens the workspace your studio already has.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Footer note ---------- */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-meta text-[0.625rem] uppercase tracking-[0.14em] text-slate">
            My Studio Pulse &middot; iPhone &middot; Free
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate">
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-mist"
            >
              View on the App Store
            </a>
            <Link href="/privacy" className="hover:text-mist">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-mist">
              Terms
            </Link>
            <Link href="/support" className="hover:text-mist">
              Support
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
