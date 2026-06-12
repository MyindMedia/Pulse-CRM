"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowDown, Check, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { TERMS_SECTIONS, TERMS_VERSION } from "@/lib/terms";
import { cn } from "@/lib/utils";

/* The onboarding gate: the owner must scroll through the full Terms of
   Service (including the Stripe Connect payments section) before the agree
   button unlocks. Acceptance is stamped on the org with the terms version. */
export function TermsStep({ onAccepted }: { onAccepted: () => void }) {
  const acceptTerms = useMutation(api.onboarding.acceptTerms);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [readToEnd, setReadToEnd] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max <= 0 ? 1 : el.scrollTop / max;
    setProgress(Math.min(1, pct));
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setReadToEnd(true);
  }

  // Short documents that fit without scrolling unlock immediately.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 12) setReadToEnd(true);
  }, []);

  async function agree() {
    setBusy(true);
    try {
      await acceptTerms({ version: TERMS_VERSION });
      onAccepted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record acceptance.");
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-10"
    >
      <div className="mb-6 flex items-center justify-between">
        <PulseLogo size="sm" asLink={false} />
        <span className="font-meta text-[0.625rem] uppercase tracking-[0.18em] text-steel/70">
          Terms · v{TERMS_VERSION}
        </span>
      </div>

      <div className="mb-5 space-y-1.5">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-bone">
          Before we set up your studio
        </h1>
        <p className="text-sm text-steel">
          Please read the terms - especially how payments work. Scroll to the end to continue.
        </p>
      </div>

      {/* Reading progress */}
      <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-coal-2">
        <div
          className="h-full bg-gold transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto rounded-lg border border-graphite/50 bg-coal p-6"
        style={{ maxHeight: "52vh" }}
      >
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-gold">
            <ScrollText className="size-4" />
            <p className="font-grotesk text-sm font-semibold text-bone">
              Pulse Terms of Service
            </p>
          </div>
          {TERMS_SECTIONS.map((section) => (
            <section key={section.title} className="space-y-2">
              <h2 className="font-grotesk text-sm font-semibold text-bone">{section.title}</h2>
              {section.body.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-steel">
                  {p}
                </p>
              ))}
            </section>
          ))}
          <p className="border-t border-graphite/50 pt-4 text-xs text-steel/70">
            End of terms. By continuing you accept version {TERMS_VERSION} on behalf of your studio.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs transition-colors",
            readToEnd ? "text-positive" : "text-steel/70",
          )}
        >
          {readToEnd ? (
            <>
              <Check className="size-3.5" />
              Read to the end
            </>
          ) : (
            <>
              <ArrowDown className="size-3.5 animate-bounce" />
              Scroll to read the full terms
            </>
          )}
        </span>
        <Button disabled={!readToEnd || busy} onClick={() => void agree()}>
          {busy ? "Saving…" : "I agree - continue"}
        </Button>
      </div>
    </motion.div>
  );
}
