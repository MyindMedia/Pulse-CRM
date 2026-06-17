import { HlsVideo } from "./hls-video";

/** Fixed, full-viewport animated background loop sitting behind the entire
 *  landing page. Near-black base + the looping video at low opacity + a dark
 *  vertical wash so every section stays readable over it. Swap the loop by
 *  passing `src` (defaults to the placeholder stream in HlsVideo). */
export function SiteBackdrop() {
  return (
    <div aria-hidden className="fixed inset-0 -z-30 overflow-hidden bg-ink">
      {/* Desaturated so the source footage never fights the brand... */}
      <HlsVideo
        src="/bg-loop.mp4"
        className="site-bg-video absolute inset-0 h-full w-full object-cover"
        style={{ filter: "grayscale(1) brightness(0.8) contrast(1.15)" }}
      />
      {/* ...then recolored to Pulse gold via a color blend. Keeps any video
          (placeholder or final loop) reading as molten gold on black. */}
      <div className="site-bg-gold absolute inset-0 mix-blend-color" style={{ background: "var(--color-gold)" }} />
      {/* Readability wash across the whole page. Built on --color-ink so it
          follows the theme (deep on dark, warm-white on light). */}
      <div className="site-bg-wash absolute inset-0" />
    </div>
  );
}
