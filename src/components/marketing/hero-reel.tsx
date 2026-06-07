import { HlsVideo } from "./hls-video";

/** Framed studio-montage reel for the hero: a 16:9 liquid-glass framed player
 *  showing the high-end studio footage (slow pans across rooms, gear, mics),
 *  sitting over the global gold backdrop. Natural color (real footage), with a
 *  soft gold glow beneath the frame. Renders nothing until a src is provided. */
export function HeroReel({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <div className="relative mx-auto mt-14 w-full max-w-4xl">
      <div className="liquid-frame aspect-video overflow-hidden rounded-2xl">
        <HlsVideo src={src} className="h-full w-full object-cover" />
      </div>
      {/* soft gold glow under the frame */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -bottom-10 -z-10 h-40 blur-3xl"
        style={{
          background:
            "radial-gradient(50% 80% at 50% 50%, rgba(253,185,19,0.12), transparent 70%)",
        }}
      />
    </div>
  );
}
