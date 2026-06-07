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
        className="absolute inset-0 h-full w-full object-cover opacity-[0.4]"
        style={{ filter: "grayscale(1) brightness(0.8) contrast(1.15)" }}
      />
      {/* ...then recolored to Pulse gold via a color blend. Keeps any video
          (placeholder or final loop) reading as molten gold on black. */}
      <div
        className="absolute inset-0 mix-blend-color"
        style={{ background: "var(--color-gold)", opacity: 0.55 }}
      />
      {/* Readability wash across the whole page */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,8,10,0.5) 0%, rgba(8,8,10,0.76) 50%, rgba(8,8,10,0.9) 100%)",
        }}
      />
    </div>
  );
}
