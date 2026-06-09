import { DashboardSim } from "./dashboard-sim";
import { MobileSim } from "./mobile-sim";
import { Reveal } from "./reveal";

/* "In the studio" — device-mockup section. A laptop runs the live desktop Pulse
 * UI (DashboardSim) and a phone runs the live mobile UI (MobileSim), each framed
 * in a chrome bezel with a gold hover frame. Real UI on every screen. */
export function WorkSection() {
  return (
    <section id="in-the-studio" className="relative overflow-hidden bg-obsidian px-4 py-32 lg:px-8 lg:py-40">
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
          <h2 className="chrome-display chrome-fill mt-5 max-w-2xl text-[clamp(2.25rem,5.5vw,4.25rem)] leading-[1.04]">
            Built for the room
            <br />
            you work in<span className="text-gold">.</span>
          </h2>
          <p className="font-grotesk mt-6 max-w-xl text-[17px] leading-relaxed tracking-[-0.01em] text-mist/80">
            From the front desk to the live room, Pulse runs on every screen —
            so the session keeps moving whether you are at the console or on the way in.
          </p>
        </Reveal>

        <div className="mt-20 grid items-end gap-10 lg:mt-24 lg:grid-cols-[1.7fr_1fr]">
          {/* Laptop — live desktop UI */}
          <Reveal>
            <figure className="group">
              <div className="overflow-hidden rounded-chrome rounded-b-none border border-graphite/70 bg-coal ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60">
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-obsidian" style={{ containerType: "inline-size" }}>
                  <DashboardSim start={2} />
                  <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(115deg, rgba(255,255,255,0.06) 0%, transparent 30%)" }} />
                </div>
              </div>
              {/* Laptop base */}
              <div className="mx-auto h-3 w-[103%] -translate-x-[1.5%] rounded-b-[1.2rem] border border-t-0 border-graphite/70 bg-coal-2" />
              <figcaption className="chrome-meta mt-6 text-steel/80">Front desk · bookings, rooms, deposits</figcaption>
            </figure>
          </Reveal>

          {/* Phone — live mobile UI */}
          <Reveal delay={120}>
            <figure className="group mx-auto w-[min(72vw,260px)]">
              <div className="relative overflow-hidden rounded-[2.2rem] border border-graphite/70 bg-coal p-[0.5rem] ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60">
                {/* Notch */}
                <div className="absolute left-1/2 top-[0.5rem] z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-coal" />
                <div className="relative aspect-[9/19] w-full overflow-hidden rounded-[1.7rem] bg-obsidian" style={{ containerType: "inline-size" }}>
                  <MobileSim />
                  <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.06) 0%, transparent 26%)" }} />
                </div>
              </div>
              <figcaption className="chrome-meta mt-6 text-center text-steel/80">On the move · the booking just landed</figcaption>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
