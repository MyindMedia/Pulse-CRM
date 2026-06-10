import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";

export function FinalCta() {
  return (
    <section className="relative px-4 py-24 lg:px-8">
      <Reveal className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-chrome border border-gold/40 bg-obsidian/70 px-6 py-20 text-center shadow-gold-soft sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(60% 70% at 50% 0%, rgba(253,185,19,0.14), transparent 70%)",
            }}
          />
          {/* Rendered chrome badge, idling on a slow 3D swing (desktop only). */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 top-1/2 hidden w-44 -translate-y-1/2 [perspective:900px] lg:block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/badge-pulse.png"
              alt=""
              draggable={false}
              className="badge-swing w-full select-none opacity-90 drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)] [transform-style:preserve-3d]"
            />
          </div>
          <div className="relative">
            <h2 className="chrome-display mx-auto max-w-3xl text-5xl text-bone sm:text-7xl">
              Run your <span className="text-gold">whole</span> studio on Pulse
            </h2>
            <p className="font-grotesk mx-auto mt-6 max-w-xl text-[17px] font-medium tracking-[-0.01em] text-mist/80">
              Pick a plan, connect your Stripe, and take your first booking today.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="#pricing"
                className="group inline-flex items-center gap-2 rounded-chrome bg-gold px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright"
              >
                Get started
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/sign-in"
                className="chrome-ghost chrome-ghost-gold inline-flex items-center rounded-chrome px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-mist transition-colors hover:text-gold"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
