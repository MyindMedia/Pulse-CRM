"use client";

import * as React from "react";

/* The hero: a photograph of an iPhone 17 Pro on a stand in a studio, with the
 * real app playing in the screen.
 *
 * The loop is 22 silent seconds cut from the App Review screen recording - a
 * session opened and scrolled through its action list, then the patch list, the
 * More menu and a client message. Real build on a physical device, which is the
 * whole reason to use it rather than a simulated UI.
 *
 * PLACEMENT IS MEASURED, NOT EYEBALLED. The white screen area was found by
 * thresholding the source JPEG (2732x1536) for near-white pixels in the phone's
 * column and reading the row extents. That gives the screen as a quad:
 *
 *     top-left  (2012,  415)     top-right  (2407,  411)
 *     bottom-left (1983, 1264)   bottom-right (2387, 1260)
 *
 * which is a 399.5 x 849 rectangle rotated 1.96 degrees clockwise, centred at
 * (2197, 838). Everything below is that, in percentages of the image, so it
 * holds at any rendered size.
 *
 * The bottom edge is deliberately set ABOVE the measured screen bottom. The
 * wooden stand's lip crosses at y roughly 1270 and the screen ends around 1264,
 * so there are only a few pixels in it - the overlay stops short and is clipped
 * by overflow-hidden on a rounded box, so the video can never paint onto the
 * stand even if the render scales a fraction differently.
 */

const MOCKUP_SRC = "/mobile/studio-mockup.jpg";
const VIDEO_SRC = "/mobile/app-loop.mp4";
const VIDEO_WEBM = "/mobile/app-loop.webm";
const POSTER_SRC = "/mobile/app-loop-poster.jpg";

/* Measured off the source image. Percentages of the full frame. */
const SCREEN = {
  left: "73.115%",
  top: "26.888%",
  width: "14.623%",
  height: "55.273%",
  rotate: "1.96deg",
  radius: "11.26% / 5.30%",
} as const;

/* ---------- reduced motion, hydration-safe ---------- */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function usePrefersReducedMotion() {
  return React.useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(QUERY).matches
        : true,
    () => true, // server snapshot: assume reduced, never flash motion
  );
}

export function StudioMockup() {
  const reduced = usePrefersReducedMotion();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const hostRef = React.useRef<HTMLDivElement>(null);

  /* Pause when it scrolls away - a decoding video behind the fold is pure
     battery, and this one loops forever. */
  React.useEffect(() => {
    const host = hostRef.current;
    const video = videoRef.current;
    if (reduced || !host || !video) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.05 },
    );
    io.observe(host);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <figure ref={hostRef} className="relative m-0 w-full overflow-hidden rounded-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={MOCKUP_SRC}
        alt="An iPhone 17 Pro on a wooden stand on a studio desk, running My Studio Pulse, with a guitarist and a mixing console out of focus behind it"
        width={2048}
        height={1151}
        className="block h-auto w-full"
      />

      {/* The screen. overflow-hidden on the rounded box is what keeps the video
          inside the glass and off the stand. */}
      <div
        aria-hidden="true"
        className="absolute overflow-hidden"
        style={{
          left: SCREEN.left,
          top: SCREEN.top,
          width: SCREEN.width,
          height: SCREEN.height,
          transform: `rotate(${SCREEN.rotate})`,
          borderRadius: SCREEN.radius,
        }}
      >
        {reduced ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={POSTER_SRC}
            alt=""
            className="block size-full object-cover"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={POSTER_SRC}
            className="block size-full object-cover"
          >
            <source src={VIDEO_WEBM} type="video/webm" />
            <source src={VIDEO_SRC} type="video/mp4" />
          </video>
        )}

        {/* The glass is not a perfect window: a faint sheen across the top left
            keeps the screen sitting in the photograph instead of on top of it. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(148deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 26%, rgba(255,255,255,0) 44%)",
          }}
        />
      </div>
    </figure>
  );
}
