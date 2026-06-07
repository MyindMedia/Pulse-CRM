import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";

export function FinalCta() {
  return (
    <section className="relative px-4 py-24 lg:px-8">
      <Reveal className="mx-auto max-w-4xl">
        <div className="relative overflow-hidden rounded-3xl border border-gold-dim bg-coal-2/60 px-6 py-16 text-center shadow-gold-soft sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(60% 70% at 50% 0%, rgba(253,185,19,0.14), transparent 70%)",
            }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight text-bone sm:text-5xl">
              Run your whole studio on Pulse
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-ash">
              Start free, connect your Stripe, and take your first booking today.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Get started <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">Log in</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
