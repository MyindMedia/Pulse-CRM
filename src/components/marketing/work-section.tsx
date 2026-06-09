import { HlsVideo } from "./hls-video";
import { Reveal } from "./reveal";

/* "In the studio" — device-mockup section in the bright register. A laptop and a
 * phone hold looping studio b-roll (Higgsfield), framed in chrome bezels with a
 * gold hover frame. Videos are muted/looping; grayscale-gold tint keeps them on
 * brand. Loops: public/work-laptop.mp4 (16:9), public/work-phone.mp4 (9:16). */
export function WorkSection() {
  return (
    <section id="in-the-studio" className="relative overflow-hidden bg-obsidian px-4 py-28 lg:px-8">
      {/* Soft top hairline + faint gold floor glow. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-graphite/40" />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-10%] left-1/2 h-[40%] w-[70%] -translate-x-1/2 rounded-full opacity-50 blur-[140px]"
        style={{ background: "radial-gradient(closest-side, rgba(253,185,19,0.12), transparent)" }}
      />

      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="chrome-meta text-steel">In the studio</p>
          <h2 className="chrome-display chrome-fill mt-4 max-w-2xl text-[clamp(2.25rem,5.5vw,4.25rem)] leading-[0.95]">
            Built for the room
            <br />
            you work in<span className="text-gold">.</span>
          </h2>
          <p className="font-grotesk mt-5 max-w-xl text-[17px] leading-relaxed tracking-[-0.01em] text-mist/80">
            From the front desk to the live room, Pulse runs on every screen —
            so the session keeps moving whether you are at the console or on the way in.
          </p>
        </Reveal>

        <div className="mt-16 grid items-end gap-8 lg:grid-cols-[1.7fr_1fr]">
          {/* Laptop */}
          <Reveal>
            <figure className="group">
              <div className="overflow-hidden rounded-chrome rounded-b-none border border-graphite/70 bg-coal ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60">
                <div className="relative aspect-[16/10] w-full bg-obsidian">
                  <HlsVideo
                    src="/work-laptop.mp4"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ filter: "grayscale(0.4) contrast(1.05)" }}
                  />
                  <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(115deg, rgba(255,255,255,0.08) 0%, transparent 30%)" }} />
                </div>
              </div>
              {/* Laptop base */}
              <div className="mx-auto h-3 w-[103%] -translate-x-[1.5%] rounded-b-[1.2rem] border border-t-0 border-graphite/70 bg-coal-2" />
              <figcaption className="chrome-meta mt-5 text-steel/80">Front desk · bookings, rooms, deposits</figcaption>
            </figure>
          </Reveal>

          {/* Phone */}
          <Reveal delay={120}>
            <figure className="group mx-auto w-[min(72vw,260px)]">
              <div className="relative overflow-hidden rounded-[2rem] border border-graphite/70 bg-coal p-2 ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60">
                {/* Notch */}
                <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-coal" />
                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.4rem] bg-obsidian">
                  <HlsVideo
                    src="/work-phone.mp4"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ filter: "grayscale(0.4) contrast(1.05)" }}
                  />
                  <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.08) 0%, transparent 26%)" }} />
                </div>
              </div>
              <figcaption className="chrome-meta mt-5 text-center text-steel/80">On the move · the booking just landed</figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
