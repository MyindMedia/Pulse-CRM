import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { DownloadBlock, APP_STORE_URL } from "./download-block";
import { Phone3DMount } from "./phone-3d-mount";

/* studiopulse.tech/mobile - the download page for My Studio Pulse.
 *
 * Deliberately says nothing about what Pulse costs. The iPhone app is free and
 * sells nothing, which is the whole basis of the 3.1.3(f) companion-app case we
 * made to App Review; a price on the page that fronts the download is the last
 * place that argument should spring a leak. Studios are onboarded by
 * invitation, so the only call to action here is "get the app", never "buy".
 *
 * Screenshots are the real App Store set. next/image serves them with a
 * one-year immutable cache keyed on the PATH, so a replacement screenshot needs
 * a new filename - overwriting public/mobile/1-today.png ships nothing. */

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

type Screen = { src: string; alt: string; label: string; note: string };

/* Order is the order a studio meets the app: the shift, then the day, then the
   room, then the money. */
const SCREENS: Screen[] = [
  {
    src: "/mobile/1-today.png",
    alt: "The Today screen showing a running shift, who else is on, and what is booked next",
    label: "Today",
    note: "One tap to clock in. The running shift lives in the Dynamic Island and on the Lock Screen, so clocking out never needs the app open.",
  },
  {
    src: "/mobile/5-schedule.png",
    alt: "Seven days of sessions across every room, with a session open for edit",
    label: "Schedule",
    note: "Seven days across every room. Confirm, reschedule, extend or assign an engineer from the session itself.",
  },
  {
    src: "/mobile/3-prep.png",
    alt: "The arrival prep checklist for a session, ready before the client walks in",
    label: "Prep",
    note: "Arrival prep and session checklists, so the room is ready before the client walks in and closed out properly after they leave.",
  },
  {
    src: "/mobile/2-patch.png",
    alt: "The patch record showing every device in the room and what is connected to what",
    label: "Patch",
    note: "Every device in the room, every input and output, and what is connected to what. Change it on the phone and the studio's record changes.",
  },
  {
    src: "/mobile/4-dashboard.png",
    alt: "The dashboard with bookings, invoices and payments at a glance",
    label: "Money",
    note: "Bookings, invoices and payments at a glance. Record a payment or send a reminder without sitting down.",
  },
  {
    src: "/mobile/6-shift.png",
    alt: "The team shift board showing who is rostered and who is clocked in",
    label: "Team",
    note: "Who is rostered, who is actually clocked in, and who has not turned up yet.",
  },
];

/* A phone. Bezel, Dynamic Island, screen. Sized by its parent's width so the
   hero device and the rail devices share one component. */
function Phone({
  screen,
  priority = false,
  className = "",
}: {
  screen: Screen;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-[2.6rem] bg-obsidian p-[0.6rem] shadow-[0_2px_0_rgba(255,255,255,0.06)_inset,0_40px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-hairline ${className}`}
    >
      <div className="relative overflow-hidden rounded-[2.1rem] bg-ink">
        <Image
          src={screen.src}
          alt={screen.alt}
          width={607}
          height={1320}
          priority={priority}
          sizes="(max-width: 640px) 70vw, 320px"
          className="block h-auto w-full"
        />
        {/* Dynamic Island */}
        <div
          aria-hidden
          className="absolute left-1/2 top-[1.6%] h-[3.4%] w-[30%] -translate-x-1/2 rounded-full bg-black"
        />
      </div>
    </div>
  );
}

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
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
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

          <div className="relative mx-auto w-[min(76vw,21rem)] lg:w-full lg:max-w-[23rem]">
            {/* A single soft gold wash behind the device - the one warm thing
                on the page, so it reads as light rather than decoration. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-16 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(253,185,19,0.16),transparent_72%)] blur-2xl"
            />
            <Phone3DMount />
            <p className="mt-5 text-center font-meta text-[0.625rem] uppercase tracking-[0.14em] text-slate">
              iPhone 17 Pro Max. Recorded on a physical device, real build.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Screens ---------- */}
      <section className="border-t border-hairline bg-ink-2">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:py-24">
          <header className="flex max-w-2xl flex-col gap-3">
            <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-slate">
              What you get
            </p>
            <h2 className="font-grotesk text-2xl font-bold tracking-tight text-bone sm:text-3xl">
              Six screens, no dashboard tourism.
            </h2>
            <p className="text-sm leading-relaxed text-steel">
              These are the real screens, not renders. Everything here is the same workspace the
              studio runs on the web, with the same permissions, so an engineer sees the session
              and an owner sees the money.
            </p>
          </header>

          <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
            {SCREENS.map((s) => (
              <li key={s.src} className="flex flex-col gap-6">
                <Phone screen={s} className="w-[min(62vw,16rem)] sm:w-full" />
                <div className="flex flex-col gap-2">
                  <h3 className="font-meta text-[0.6875rem] uppercase tracking-[0.16em] text-gold">
                    {s.label}
                  </h3>
                  <p className="text-sm leading-relaxed text-steel">{s.note}</p>
                </div>
              </li>
            ))}
          </ul>
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
