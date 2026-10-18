"use client";

import { Bell01, CalendarCheck01, Check, PhoneCall01, UserPlus01 } from "@untitledui/icons";
import { ExplainerPlayer } from "@/components/marketing/explainer-video";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

/* Matches what actually happens after a demo booking: the Zuops confirmation
   text, the Bland confirmation call (convex/outreachCalls.ts: about 5 minutes
   after booking, 9 AM to 8 PM Pacific, from CALL_NUMBER), then the Zuops 24 hour
   and 1 hour reminder texts. Change this when any of those change. */
const CALL_NUMBER_DISPLAY = "(408) 692-1713";

const STEPS = [
  { label: "Booked", when: "Just now", done: true, icon: "check" },
  { label: "Confirmation text", when: "On its way", done: true, icon: "check" },
  { label: "Quick call", when: "To confirm your time", icon: "call" },
  { label: "Reminder", when: "24 hours before", icon: "bell" },
  { label: "Reminder", when: "1 hour before", icon: "bell" },
  { label: "Your demo", when: "30 minutes, your studio", icon: "demo" },
] as const;

export function BookedExperience() {
  return (
    <div className="mx-auto max-w-5xl">
      <BookingMoment />
      <CallHeadsUp />
      <WhileYouWait />
    </div>
  );
}

/* --------------------------- 1. the booking alert --------------------------- */

function BookingMoment() {
  return (
    <section className="text-center" aria-labelledby="booked-title">
      <div
        role="status"
        className="mx-auto flex max-w-sm items-center gap-3 rounded-chrome border border-gold/40 bg-obsidian/90 p-4 text-left shadow-gold-soft animate-[booked-toast_0.8s_cubic-bezier(0.2,0.9,0.25,1.15)_0.25s_both] motion-reduce:animate-none"
      >
        <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-gold text-gold-ink">
          <span aria-hidden className="absolute inset-0 rounded-full bg-gold/60 animate-[pulse-ring_2.4s_ease-out_1.1s_infinite] motion-reduce:hidden" />
          <CalendarCheck01 className="relative size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="chrome-meta flex items-center justify-between text-steel">
            <span>Pulse</span>
            <span>now</span>
          </span>
          <span className="font-grotesk mt-0.5 block text-[15px] font-semibold text-bone">New booking: Pulse demo</span>
          <span className="font-grotesk block text-sm text-mist">Confirmed. Reminders scheduled.</span>
        </span>
      </div>

      <Reveal immediate delay={500}>
        <h1 id="booked-title" className="chrome-display chrome-fill mt-10 text-[2.75rem] leading-[1.02] sm:text-7xl">
          Your session is booked.
        </h1>
        <p className="font-grotesk mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-mist">
          That alert is the moment Pulse is built around. Soon it will be your clients booking at
          1&nbsp;AM, paying the deposit, and getting their reminders, while you sleep.
        </p>
      </Reveal>

      <Reveal immediate delay={800}>
        <ol className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 text-left sm:grid-cols-6 sm:gap-0">
          {STEPS.map((s, i) => (
            <li key={i} className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
              {i > 0 && (
                <span aria-hidden className={cn("absolute top-4 hidden h-px w-full -translate-x-1/2 sm:block", "done" in s ? "bg-gold" : "bg-gold/20")} />
              )}
              <span
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-full border",
                  "done" in s ? "border-gold bg-gold text-gold-ink" : "border-gold/30 bg-ink text-gold/70",
                )}
              >
                {s.icon === "check" ? (
                  <Check className="size-4" aria-hidden />
                ) : s.icon === "call" ? (
                  <PhoneCall01 className="size-4" aria-hidden />
                ) : s.icon === "bell" ? (
                  <Bell01 className="size-4" aria-hidden />
                ) : (
                  <span className="size-2 rounded-full bg-gold animate-[logo-breathe_2.4s_ease-in-out_infinite] motion-reduce:animate-none" />
                )}
              </span>
              <span>
                <span className="font-grotesk block text-sm font-semibold text-bone">{s.label}</span>
                <span className="font-grotesk block text-xs text-steel">{s.when}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="font-grotesk mt-6 text-sm text-steel">The same reminders your clients will get, on their own.</p>
      </Reveal>
    </section>
  );
}

/* --------------------------- 2. the call --------------------------- */

function CallHeadsUp() {
  return (
    <section aria-labelledby="call-title" className="mt-28">
      <Reveal className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center gap-6 rounded-chrome border border-gold/40 bg-obsidian/80 p-6 text-center shadow-gold-soft sm:flex-row sm:p-8 sm:text-left">
          <span className="relative grid size-16 shrink-0 place-items-center rounded-full bg-gold text-gold-ink">
            <span aria-hidden className="absolute inset-0 rounded-full animate-[pulse-ring_2.4s_ease-out_infinite] motion-reduce:hidden" />
            <PhoneCall01 className="relative size-7" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="chrome-meta text-gold">Pick up this one</p>
            <h2 id="call-title" className="chrome-display mt-2 text-[1.75rem] leading-[1.05] text-bone sm:text-4xl">
              Expect a quick call
            </h2>
            <p className="font-grotesk mt-3 text-[15px] leading-relaxed text-mist">
              Our AI assistant calls from <span className="whitespace-nowrap font-semibold text-bone">{CALL_NUMBER_DISPLAY}</span> a
              few minutes after you book, between 9 AM and 8 PM Pacific, to confirm your time. Save
              the number so it rings through.
            </p>
          </div>
          <a
            href="/pulse-demo-call.vcf"
            download="Pulse.vcf"
            className={cn(
              "group inline-flex shrink-0 items-center gap-2 rounded-chrome bg-gold px-6 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright",
              focusRing,
            )}
          >
            <UserPlus01 className="size-4" aria-hidden />
            Save the number
          </a>
        </div>
      </Reveal>
    </section>
  );
}

/* --------------------------- 3. the film --------------------------- */

function WhileYouWait() {
  return (
    <section aria-labelledby="watch-title" className="mt-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="chrome-meta text-gold">While you wait</p>
        <h2 id="watch-title" className="chrome-display chrome-fill mt-3 text-[2rem] sm:text-5xl">One session, start to finish</h2>
        <p className="font-grotesk mt-4 text-base leading-relaxed text-mist">
          One booking from a 1:12 AM request to a paid balance. Your demo goes deeper
          on the parts you picked.
        </p>
      </Reveal>
      <Reveal className="mt-10" delay={80}>
        <ExplainerPlayer />
      </Reveal>
      <p className="font-grotesk mt-10 text-center text-sm text-steel">
        Need another time? Reply to your confirmation text and we will move it.
      </p>
    </section>
  );
}
