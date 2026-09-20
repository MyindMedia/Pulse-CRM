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
 * GEOMETRY IS MEASURED, NOT EYEBALLED. Thresholding the source JPEG
 * (2732x1536) for near-white pixels in the phone's column and fitting straight
 * lines to the left and right edges over ~680 rows gives
 *
 *     left  x = -0.04876 y + 2036.02
 *     right x = -0.02482 y + 2418.50
 *
 * The two edges converge going up, so the screen is a TRAPEZOID, not a rotated
 * rectangle: 394px across the top, 413px across the bottom. A CSS rotate cannot
 * express that, which is why this maps the video with a real homography instead.
 *
 * The top edge is the first row carrying any white (y=411); full width arrives
 * at y=464, so the corner radius is 53px, 13.2% of the screen width - which is
 * what a real iPhone measures. The bottom is derived from the video's own
 * 720x1564 aspect rather than measured, BECAUSE IT IS NOT VISIBLE: the wooden
 * stand crosses at y=1268 and the screen truly ends at y=1282. Those last 14px
 * are behind the wood, so the video is mapped onto the whole screen and then
 * clipped at the stand line. Mapping it onto only the visible part would
 * squash the picture by 2%.
 */

const MOCKUP_SRC = "/mobile/studio-mockup.jpg";
const VIDEO_SRC = "/mobile/app-loop.mp4";
const VIDEO_WEBM = "/mobile/app-loop.webm";
const POSTER_SRC = "/mobile/app-loop-poster.jpg";

/* The screen's four corners, as fractions of the frame. Clockwise from top left. */
const QUAD = [
  [0.73791, 0.26758], // TL
  [0.88151, 0.26758], // TR
  [0.87361, 0.83490], // BR
  [0.72236, 0.83490], // BL
] as const;

/* Where the wooden stand crosses in front of the phone, as a fraction of the
   frame height. Everything below this is wood, never screen. */
const STAND_CUT = 0.82552;

/* Corner radius as a fraction of the screen's width. */
const RADIUS = 0.132;

/* Outward bleed. The edge fit is good to a few pixels, not to the pixel, and a
   few pixels short shows as a pale sliver of the mockup's own white screen down
   the side - the one thing that gives the composite away. So the quad is grown
   about its centre and allowed to run UNDER the bezel, which is roughly 10px of
   dark metal on a 400px screen at this scale. 1.5% per side is about 6px: enough
   to bury the error, not enough to climb onto the frame. The bottom gets extra
   because the stand mask eats it anyway. */
const BLEED = 1.03;
const BLEED_BOTTOM = 0.03;

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

export function StudioMockup() {
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
      const dst = raw.map(([x, y], i) => {
        const p: [number, number] = [cx + (x - cx) * BLEED, cy + (y - cy) * BLEED];
        if (i >= 2) p[1] += (raw[3][1] - raw[0][1]) * BLEED_BOTTOM; // BR and BL
        return p;
      });
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
      { threshold: 0.05 },
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
  }, [reduced]);

  return (
    <figure ref={figureRef} className="relative m-0 w-full overflow-hidden rounded-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={MOCKUP_SRC}
        alt="An iPhone 17 Pro on a wooden stand on a studio desk, running My Studio Pulse, with a guitarist and a mixing console out of focus behind it"
        width={2048}
        height={1151}
        className="block h-auto w-full"
      />

      {/* The stand mask. Everything below this line is wood, so the screen
          layer is cut here and can never paint over it. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ clipPath: `inset(0 0 ${((1 - STAND_CUT) * 100).toFixed(3)}% 0)` }}
      >
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
