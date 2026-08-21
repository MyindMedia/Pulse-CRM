"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { FileSignature, ArrowRight } from "lucide-react";

/**
 * Asks a beta studio for the signature it still owes.
 *
 * A studio converted onto the beta gets the licence immediately, so it is
 * already using the product. The agreement still has to be signed, and an
 * email is easy to miss, so the ask lives in the app until it is done.
 *
 * A banner rather than a lock: they are a paying-relationship customer who was
 * given a year, not a stranger at the door. Blocking their studio over
 * paperwork would be the wrong trade.
 */
export function BetaSignatureBanner() {
  const state = useQuery(api.betaAccess.myBetaSignature);
  if (!state?.needed) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gold-dim/40 bg-gold/[0.08] px-4 py-2 lg:px-6">
      <FileSignature className="size-4 shrink-0 text-gold" aria-hidden />
      <p className="min-w-0 text-xs text-bone">
        You are on the Pulse beta, which includes features that are not announced yet.
        There is a short confidentiality agreement to sign.
      </p>
      <Link
        href={`/preview?code=${encodeURIComponent(state.code)}`}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-3 py-1.5 font-meta text-[0.65rem] uppercase tracking-[0.06em] text-gold-ink transition-opacity hover:opacity-90"
      >
        Read and sign
        <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
