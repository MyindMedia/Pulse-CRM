import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";
import { DownloadBlock } from "./download-block";
import { StudioMockup } from "./studio-mockup";

/* The iPhone app, inside the gold-edged, glowing container that used to close
 * the page and now follows the features section. The photograph on the right is the
 * /mobile hero (the real app playing in a phone on a studio desk), cropped
 * tight on the phone: the figure is laid out at 260% of its column and
 * offset so the handset sits centred in a 4:5 window. The mockup component
 * measures its own box, so a plain width and offset keep its screen mapping
 * exact; a CSS scale would not. */

export function MobileAppSection() {
  return (
    <section className="relative px-4 py-24 lg:px-8">
      <Reveal className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-chrome border border-gold/40 bg-obsidian/70 px-6 py-14 shadow-gold-soft sm:px-12 lg:py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(60% 70% at 50% 0%, rgba(253,185,19,0.14), transparent 70%)",
            }}
          />

          <div className="relative grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
            <div className="flex flex-col items-start gap-7">
              <p className="chrome-meta text-[0.6875rem] text-gold">
                My Studio Pulse &middot; Free on the App Store
              </p>
              <h2
                className="chrome-display max-w-[14ch] text-balance text-4xl text-bone sm:text-6xl"
                style={{ lineHeight: 1.06 }}
              >
                Run the studio from your iPhone
              </h2>
              <p className="font-grotesk max-w-[44ch] text-[17px] font-medium tracking-[-0.01em] text-mist/80">
                The free iPhone app for studios on Pulse. Your team clocks in from their phones
                and tracks the schedule. You see bank balances, receipts matched automatically and
                what each client owes, on the same accounts you use here.
              </p>

              <DownloadBlock />

              <Link
                href="/mobile"
                className="group inline-flex items-center gap-2 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold transition-colors hover:text-gold-bright"
              >
                More about the app
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>

            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-chrome border border-gold/20">
              <div className="absolute" style={{ width: "260%", left: "-158%", top: "-18.5%" }}>
                <StudioMockup />
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
