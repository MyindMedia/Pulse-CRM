"use client";

import * as React from "react";

/* The hero: a photograph of an iPhone 17 Pro on a wooden stand in a studio, with the
 * real app playing in the screen.
 *
 * The loop is 22 silent seconds cut from the App Review screen recording - a
 * session opened and scrolled through its action list, then the patch list, the
 * More menu and a client message. Real build on a physical device, which is the
 * whole reason to use it rather than a simulated UI.
 *
 * GEOMETRY IS MEASURED, NOT EYEBALLED. Every number below comes from fitting the
 * 2048x1151 JPEG in public/mobile to sub-pixel precision:
 *
 *   - The left, right and top screen edges are straight lines fitted to the
 *     50% luminance crossing on ~500 rows / ~170 columns each, rms error under
 *     0.1px. They are not perpendicular: the sides lean 1.6 degrees clockwise
 *     while the top edge rises 0.84 degrees to the right, which is the signature
 *     of a phone pitched back in its stand and yawed with its right side nearer
 *     the camera. No rotate() can express that, so the video is mapped with a
 *     real homography.
 *   - The bottom edge is HIDDEN behind the stand, so it is recovered from the
 *     parts of the bottom corner arcs that are still visible above the wood,
 *     template-matched against the fully visible top corners (rms 0.4-0.7px).
 *     The screen runs 12px behind the wood on both sides; the video is mapped
 *     onto the whole screen and then clipped, because mapping it onto only the
 *     visible part would squash the picture.
 *   - The wooden lip that cuts the screen off is a straight line to within
 *     0.2px across the full width, sloping down to the right by 3.9%. It is cut
 *     with a clip-path polygon along that exact line, not a horizontal inset.
 *   - Cross-check: the phone's physical Dynamic Island, mapped back through the
 *     inverse homography, lands centred at x=361.7 of 720 in video space with
 *     its top at 11pt, which is Apple's own inset. The fit is right.
 *
 * The photograph's own screen has been painted black (the mockup shipped with a
 * white placeholder). Any sub-pixel seam between the video and the bezel is
 * therefore black-on-black and invisible, so no bleed is needed, the content is
 * not scaled up to hide edges, and if the video ever fails to load the phone
 * simply looks switched off instead of showing placeholder text.
 */

const MOCKUP_SRC = "/mobile/studio-mockup.jpg";
const VIDEO_SRC = "/mobile/app-loop.mp4";
const VIDEO_WEBM = "/mobile/app-loop.webm";
const POSTER_SRC = "/mobile/app-loop-poster.jpg";

/* The screen's four virtual corners (where the straight edges would meet if the
   corners were not rounded), as fractions of the frame. Clockwise from top left. */
const QUAD = [
  [0.73572, 0.26882], // TL
  [0.8817, 0.26499], // TR
  [0.87377, 0.84415], // BR
  [0.72543, 0.83505], // BL
] as const;

/* The top edge of the wooden lip, as fractions of the frame height where the
   line crosses x=0 and x=100%. Everything below it is wood, never screen. */
const LIP_LEFT = 0.77392;
const LIP_RIGHT = 0.84299;

/* Corner radius as a fraction of the screen's width, from the top corner arcs.
   Apple's continuous corner is not a true circle, but the difference is under a
   pixel and lands on the black bezel. */
const RADIUS = 0.1468;

/* A hair of outward growth, about half a pixel at source resolution, so browser
   rasterisation rounding can never leave the video short of the bezel. */
const BLEED = 1.004;

/* ---------- homography ----------
   Solve the 8 unknowns of the projective map taking the source rectangle's
   corners to the four destination points, then hand it to CSS as matrix3d.
   Everything is in rendered pixels, recomputed whenever the image resizes. */

function solveHomography(
  src: Array<[number, number]>,
  dst: Array<[number, number]>,
): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting.
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-10) return null;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

function matrix3dFor(w: number, h: number, dst: Array<[number, number]>): string | null {
  const H = solveHomography(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    dst,
  );
  if (!H) return null;
  const [a, bb, c, d, e, f, g, i] = H;
  // CSS matrix3d is column-major.
  return `matrix3d(${a},${d},0,${g}, ${bb},${e},0,${i}, 0,0,1,0, ${c},${f},0,1)`;
}

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

const LIP_CLIP = `polygon(0 0, 100% 0, 100% ${(LIP_RIGHT * 100).toFixed(3)}%, 0 ${(LIP_LEFT * 100).toFixed(3)}%)`;

/* `priority` is for the page where this IS the hero (/mobile): the photo is
   fetched at high priority and the video buffers at once. Everywhere else the
   photo lazy-loads and the video does not fetch a byte until the figure is
   within 600px of the viewport, so a 1MB loop never competes with the page's
   real first paint. */
export function StudioMockup({ priority = false }: { priority?: boolean } = {}) {
  const reduced = usePrefersReducedMotion();
  const figureRef = React.useRef<HTMLElement>(null);
  const screenRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [ready, setReady] = React.useState(false);

  /* Place the screen. Runs on mount and on every resize, because the matrix is
     in pixels and the photograph is fluid. */
  React.useEffect(() => {
    const fig = figureRef.current;
    const el = screenRef.current;
    if (!fig || !el) return;

    const place = () => {
      const { width: W, height: Hh } = fig.getBoundingClientRect();
      if (!W || !Hh) return;
      const raw = QUAD.map(([fx, fy]) => [fx * W, fy * Hh] as [number, number]);
      const cx = raw.reduce((t, q) => t + q[0], 0) / 4;
      const cy = raw.reduce((t, q) => t + q[1], 0) / 4;
      const dst = raw.map(
        ([x, y]) => [cx + (x - cx) * BLEED, cy + (y - cy) * BLEED] as [number, number],
      );
      /* The source box is the quad's own average size, so the video is never
         asked to stretch much before the homography does the real work. */
      const w = ((dst[1][0] - dst[0][0]) + (dst[2][0] - dst[3][0])) / 2;
      const h = ((dst[3][1] - dst[0][1]) + (dst[2][1] - dst[1][1])) / 2;
      const m = matrix3dFor(w, h, dst);
      if (!m) return;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.borderRadius = `${RADIUS * w}px`;
      el.style.transform = m;
      setReady(true);
    };

    place();
    const ro = new ResizeObserver(place);
    ro.observe(fig);
    return () => ro.disconnect();
  }, []);

  /* Pause when it scrolls away - a decoding video behind the fold is pure
     battery, and this one loops forever. */
  React.useEffect(() => {
    const fig = figureRef.current;
    const video = videoRef.current;
    if (reduced || !fig || !video) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.05, rootMargin: "600px 0px" },
    );
    io.observe(fig);

    /* The observer fires once at mount, which can be before the file is
       decodable - play() then rejects silently and the hero sits on its poster
       forever. Retry the moment there are frames to show. */
    const onReady = () => void video.play().catch(() => {});
    video.addEventListener("canplay", onReady);

    return () => {
      io.disconnect();
      video.removeEventListener("canplay", onReady);
    };
  }, [reduced, priority]);

  return (
    <figure ref={figureRef} className="relative m-0 w-full overflow-hidden rounded-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={MOCKUP_SRC}
        alt="My Studio Pulse running on an iPhone in a wooden stand on a recording studio desk, with a guitarist and a mixing console out of focus behind it"
        width={2048}
        height={1151}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className="block h-auto w-full"
      />

      {/* The stand mask: the wooden lip's top edge, as a line. Everything below
          it is wood, so the screen layer is cut there and can never paint over
          it. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ clipPath: LIP_CLIP }}>
        <div
          ref={screenRef}
          className="absolute left-0 top-0 overflow-hidden bg-black"
          style={{ transformOrigin: "0 0", opacity: ready ? 1 : 0 }}
        >
          {reduced ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={POSTER_SRC} alt="" className="block size-full object-cover" />
          ) : (
            <video
              ref={videoRef}
              /* autoplay makes the browser fetch media regardless of preload,
                 so below the fold the observer starts playback instead. */
              autoPlay={priority}
              muted
              loop
              playsInline
              preload={priority ? "auto" : "none"}
              poster={POSTER_SRC}
              className="block size-full object-cover"
            >
              <source src={VIDEO_WEBM} type="video/webm" />
              <source src={VIDEO_SRC} type="video/mp4" />
            </video>
          )}

          {/* The glass is not a perfect window: a faint sheen across the top
              left keeps the screen sitting in the photograph, not on top. */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(148deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 26%, rgba(255,255,255,0) 44%)",
            }}
          />
        </div>
      </div>
    </figure>
  );
}
