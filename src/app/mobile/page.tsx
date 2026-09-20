import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Cable, Clock, ListChecks, Receipt, Users, type LucideIcon } from "lucide-react";
import { DownloadBlock, APP_STORE_URL } from "./download-block";
import { StudioMockup } from "./studio-mockup";

/* studiopulse.tech/mobile - the download page for My Studio Pulse.
 *
 * Deliberately says nothing about what Pulse costs. The iPhone app is free and
 * sells nothing, which is the whole basis of the 3.1.3(f) companion-app case we
 * made to App Review; a price on the page that fronts the download is the last
 * place that argument should spring a leak. Studios are onboarded by
 * invitation, so the only call to action here is "get the app", never "buy".
 *
 * One screen only: the photographed device in the hero, with the real app
 * playing in it. The App Store screenshot rail that used to sit below was cut -
 * the App Store page already carries those, and a second gallery of the same
 * images on the page that links to it was saying it twice. */

const TITLE = "My Studio Pulse for iPhone";
const DESCRIPTION =
  "The studio floor in your pocket. Clock in from the Lock Screen, run the day's sessions, prep the room and check the money. Free on the App Store for studios already running Pulse.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/mobile" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/mobile",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};


type Capability = { icon: LucideIcon; label: string; note: string };

/* What the app actually does, in the order a studio meets it: the shift, the
   day, the room, the money, the people. Every line is a screen that exists. */
const CAPABILITIES: Capability[] = [
  {
    icon: Clock,
    label: "Today",
    note: "Clock in and out with one tap. The running shift shows in the Dynamic Island and on the Lock Screen, so clocking out never needs the app open.",
  },
  {
    icon: CalendarDays,
    label: "Schedule",
    note: "Seven days of sessions across every room. Confirm, reschedule, extend or assign an engineer from the session itself.",
  },
  {
    icon: ListChecks,
    label: "Prep",
    note: "Arrival prep and session checklists, so the room is ready before the client walks in and closed out properly after they leave.",
  },
  {
    icon: Cable,
    label: "Patch",
    note: "Every device in the room, every input and output, and what is connected to what. Change a connection here and the studio's record changes.",
  },
  {
    icon: Receipt,
    label: "Money",
    note: "Bookings, invoices and payments at a glance. Record a payment, send a reminder or capture a receipt without sitting down.",
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
      {/* ---------- Hero ---------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div className="flex flex-col items-start gap-7">
            <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-gold">
              Now on the App Store
            </p>

            {/* Anton is condensed and very wide at display sizes; a manual
                break here fought the wrap and produced a three-line stagger.
                Let it flow inside a measure sized for it. */}
            <h1 className="max-w-[11ch] font-chrome text-[clamp(2.6rem,6.4vw,4.5rem)] uppercase leading-[0.86] tracking-[-0.005em] text-bone">
              The studio floor, in your pocket
            </h1>

            <p className="max-w-[46ch] text-base leading-relaxed text-steel sm:text-lg">
              My Studio Pulse is the staff app for studios already running Pulse. Clock in from
              the Lock Screen, work the day&rsquo;s sessions, prep the room and check the money
              without going back to a desk.
            </p>

            <DownloadBlock />

            <dl className="mt-2 grid w-full grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              <Spec k="Price" v="Free" />
              <Spec k="Requires" v="iOS 17 or later" />
              <Spec k="Built for" v="iPhone" />
              <Spec k="Offline" v="Edits queue and sync" />
            </dl>
          </div>

          <div className="relative w-full">
            <StudioMockup />
            <p className="mt-4 font-meta text-[0.625rem] uppercase tracking-[0.14em] text-slate">
              The real build, recorded on a physical iPhone
            </p>
          </div>
        </div>
      </section>

      {/* ---------- What it does ---------- */}
      <section className="border-t border-hairline bg-ink-2">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
          <header className="flex max-w-2xl flex-col gap-3">
            <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-slate">
              What it does
            </p>
            <h2 className="font-grotesk text-2xl font-bold tracking-tight text-bone sm:text-3xl">
              The floor, not the back office.
            </h2>
            <p className="text-sm leading-relaxed text-steel">
              The same workspace the studio runs on the web, with the same permissions, so an
              engineer sees the session and an owner sees the money.
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
          <div className="flex max-w-xl flex-col gap-4">
            <h2 className="font-grotesk text-2xl font-bold tracking-tight text-bone sm:text-3xl">
              You need a studio account first.
            </h2>
            <p className="text-sm leading-relaxed text-steel">
              The app signs you in to your studio&rsquo;s workspace, so there has to be one. Owners
              and managers invite their team from More &rsaquo; Team, or on the web. If your studio
              already runs Pulse, ask whoever set it up to send you an invite, then come back and
              download it.
            </p>
            <p className="text-sm leading-relaxed text-steel">
              Not on Pulse yet?{" "}
              <Link href="/support" className="text-gold underline-offset-4 hover:underline">
                Talk to us
              </Link>{" "}
              and we&rsquo;ll set your studio up.
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
