"use client";

import * as React from "react";
import { Bell01, CalendarCheck01, Check, Copy01, MessageChatSquare } from "@untitledui/icons";
import { ExplainerPlayer } from "@/components/marketing/explainer-video";
import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";
import { BOOKED_TEXT_NUMBER, QUESTIONS, briefText, focusLines, type Answers } from "./brief";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

/* The confirmation, reminder and demo steps match the Zuops texts that are
   switched on for the demo calendar (confirmation, 24 hours, 1 hour). */
const STEPS = [
  { label: "Booked", when: "Just now", done: true },
  { label: "Confirmation text", when: "On its way", done: true },
  { label: "Reminder", when: "24 hours before" },
  { label: "Reminder", when: "1 hour before" },
  { label: "Your demo", when: "30 minutes, your studio" },
];

export function BookedExperience() {
  return (
    <div className="mx-auto max-w-5xl">
      <BookingMoment />
      <BuildYourDemo />
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
        <ol className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-3 text-left sm:grid-cols-5 sm:gap-0">
          {STEPS.map((s, i) => (
            <li key={i} className="relative flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center">
              {i > 0 && (
                <span aria-hidden className={cn("absolute top-4 hidden h-px w-full -translate-x-1/2 sm:block", s.done ? "bg-gold" : "bg-gold/20")} />
              )}
              <span
                className={cn(
                  "relative grid size-8 shrink-0 place-items-center rounded-full border",
                  s.done ? "border-gold bg-gold text-gold-ink" : "border-gold/30 bg-ink text-gold/70",
                )}
              >
                {s.done ? <Check className="size-4" aria-hidden /> : i === STEPS.length - 1 ? <span className="size-2 rounded-full bg-gold animate-[logo-breathe_2.4s_ease-in-out_infinite] motion-reduce:animate-none" /> : <Bell01 className="size-4" aria-hidden />}
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

/* --------------------------- 2. build your demo --------------------------- */

function BuildYourDemo() {
  const [answers, setAnswers] = React.useState<Answers>({ rooms: null, today: null, pains: [] });
  const [copied, setCopied] = React.useState(false);
  const lines = focusLines(answers);
  const ready = answers.rooms !== null && answers.today !== null && answers.pains.length > 0;
  const text = briefText(answers);

  function pick(id: (typeof QUESTIONS)[number]["id"], value: string) {
    setCopied(false);
    setAnswers((a) => {
      if (id !== "pains") return { ...a, [id]: a[id] === value ? null : value };
      const has = a.pains.includes(value);
      if (has) return { ...a, pains: a.pains.filter((p) => p !== value) };
      return { ...a, pains: [...a.pains, value].slice(-2) };
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="build-title" className="mt-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="chrome-meta text-gold">Three taps</p>
        <h2 id="build-title" className="chrome-display chrome-fill mt-3 text-[2rem] sm:text-5xl">Build your demo</h2>
        <p className="font-grotesk mt-4 text-base leading-relaxed text-mist">
          Tell us how your studio runs and we will walk in with your demo already built around it.
        </p>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          {QUESTIONS.map((q) => (
            <fieldset key={q.id} className="rounded-chrome border border-gold/15 bg-obsidian/60 p-5">
              <legend className="font-grotesk px-1 text-sm font-semibold text-bone">
                {q.title}
                {q.id === "pains" && <span className="ml-2 font-normal text-steel">pick up to 2</span>}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {q.options.map((o) => {
                  const on = q.id === "pains" ? answers.pains.includes(o.id) : answers[q.id] === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(q.id, o.id)}
                      className={cn(
                        "font-grotesk rounded-full border px-4 py-2 text-sm transition-colors",
                        on ? "border-gold bg-gold text-gold-ink" : "border-gold/25 text-mist hover:border-gold/60 hover:text-bone",
                        focusRing,
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div
          aria-live="polite"
          className={cn(
            "flex flex-col rounded-chrome border p-6 transition-colors duration-500",
            ready ? "border-gold/60 bg-obsidian shadow-gold-soft" : "border-gold/15 bg-obsidian/40",
          )}
        >
          <p className="chrome-meta text-steel">Your demo, built around</p>
          {lines.length === 0 ? (
            <p className="font-grotesk mt-4 text-sm leading-relaxed text-steel">
              Pick what costs you the most and this fills in with what we will show you.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {lines.map((l) => (
                <li key={l.title} className="animate-[screen-in_0.45s_ease-out_both] motion-reduce:animate-none">
                  <p className="font-grotesk text-lg font-semibold text-gold">{l.title}</p>
                  <p className="font-grotesk mt-1 text-sm leading-relaxed text-mist">{l.show}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-auto pt-6">
            {ready ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href={`sms:${BOOKED_TEXT_NUMBER}?&body=${encodeURIComponent(text)}`}
                    className={cn(
                      "group inline-flex flex-1 items-center justify-center gap-2 rounded-chrome bg-gold px-5 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright",
                      focusRing,
                    )}
                  >
                    <MessageChatSquare className="size-4" aria-hidden />
                    Text it to us
                  </a>
                  <button
                    type="button"
                    onClick={copy}
                    className={cn(
                      "chrome-ghost chrome-ghost-gold inline-flex items-center justify-center gap-2 rounded-chrome px-5 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-mist transition-colors hover:text-gold",
                      focusRing,
                    )}
                  >
                    {copied ? <Check className="size-4" aria-hidden /> : <Copy01 className="size-4" aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="font-grotesk mt-3 text-xs leading-relaxed text-steel">
                  Sends to the number your confirmation came from, so it lands on your booking. On a
                  computer, copy it and reply to that text.
                </p>
              </>
            ) : (
              <p className="font-grotesk text-xs text-steel">Answer all three to send it over.</p>
            )}
          </div>
        </div>
      </div>
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
