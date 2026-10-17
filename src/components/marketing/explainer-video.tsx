"use client";

import * as React from "react";
import { Play } from "lucide-react";
import { siteMedia } from "@/lib/media";
import { Reveal } from "./reveal";

/* "One Session": the 71-second explainer that follows a single booking from a
 * 1:12 AM request to a paid balance, narrated, cut to Lawrence's own track.
 * Real Pulse screens from a demo studio, so nothing in it is a mock.
 *
 * The MP4s live in R2 (media-manifest.json); the poster and captions are tiny
 * and stay in public/. preload="none" keeps the page weight unchanged until a
 * visitor presses play, and the press itself is the user gesture that lets the
 * film start with sound. Phones get the 720p cut through <source media>. */

const POSTER = "/video/pulse-one-session-poster.jpg";
const SRC_1080 = siteMedia("/video/pulse-one-session-1080.mp4");
const SRC_720 = siteMedia("/video/pulse-one-session-720.mp4");
const CAPTIONS = "/video/pulse-one-session.en.vtt";

export function ExplainerVideo() {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [started, setStarted] = React.useState(false);

  function start() {
    const v = ref.current;
    if (!v) return;
    setStarted(true);
    // If play() is refused, the native controls are already showing.
    void v.play().catch(() => {});
  }

  return (
    <section id="watch" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-steel">See how it works &middot; 71 seconds</p>
          <h2 className="chrome-display mt-4 text-4xl leading-[1.05] text-bone sm:text-5xl">
            One session, <span className="text-gold">start to finish</span>
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/80">
            Follow one booking from a 1:12 AM request to a paid balance: reminders, check-in,
            session notes, split sheets and payroll, with nobody chasing anything.
          </p>
        </Reveal>

        <Reveal className="mt-12" delay={80}>
          <div className="relative aspect-video w-full overflow-hidden rounded-chrome border border-gold/30 bg-obsidian shadow-gold-soft">
            <video
              ref={ref}
              className="absolute inset-0 size-full object-cover"
              poster={POSTER}
              preload="none"
              playsInline
              controls={started}
              onPlay={() => setStarted(true)}
            >
              <source src={SRC_720} type="video/mp4" media="(max-width: 767px)" />
              <source src={SRC_1080} type="video/mp4" />
              <track kind="captions" src={CAPTIONS} srcLang="en" label="English" />
            </video>

            {!started && (
              <button
                type="button"
                onClick={start}
                aria-label="Play the Pulse explainer video, 71 seconds, with sound"
                className="group absolute inset-0 flex items-end justify-center bg-black/10 pb-[8%] transition-colors hover:bg-transparent sm:pb-[10%]"
              >
                {/* Lower third: the poster's "This is / PULSE" lockup owns the upper middle. */}
                <span className="grid size-14 place-items-center rounded-full bg-gold text-[#1a1400] shadow-gold-soft transition-transform duration-300 group-hover:scale-110 sm:size-20 lg:size-24">
                  <Play className="ml-1 size-6 fill-current sm:size-8 lg:size-10" />
                </span>
              </button>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
