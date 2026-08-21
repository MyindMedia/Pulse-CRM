"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { PoweredByPulse } from "@/components/brand/powered-by-pulse";
import { PublicTheme } from "@/components/shell/public-theme";

/**
 * The mark and copy above the sign-in form.
 *
 * Sign-in is shared by every studio, so there is nothing in the URL to say
 * whose door this is. It only wears a studio's brand when the studio is
 * genuinely identifiable: a ?studio=<slug> on the link, which is what a
 * white-labelled invite or a custom domain sends people in on. Everything
 * else gets Pulse chrome, because guessing would show one studio another
 * studio's branding.
 */
export function SignInBrand() {
  return (
    <Suspense fallback={<PulseMark />}>
      <Resolved />
    </Suspense>
  );
}

function PulseMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <PulseLogo size="lg" asLink={false} />
      <p className="font-meta text-[0.6875rem] uppercase tracking-[0.2em] text-steel/70">
        The studio operating system
      </p>
    </div>
  );
}

function Resolved() {
  const params = useSearchParams();
  const slug = params.get("studio") ?? undefined;
  const theme = useQuery(api.theme.publicBySlug, slug ? { slug } : "skip");

  if (!slug || !theme?.active) return <PulseMark />;

  return (
    <>
      <PublicTheme slug={slug} />
      {theme.loginBackgroundUrl && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: `url(${theme.loginBackgroundUrl})` }}
        >
          {/* The form has to stay readable whatever they upload, so the image
              always sits under a scrim rather than being trusted on its own. */}
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-[2px]" />
        </div>
      )}
      <div className="flex flex-col items-center gap-2 text-center">
        {theme.logoUrl ? (
          <img
            src={theme.logoUrl}
            alt={theme.appName ?? "Studio"}
            className="max-h-14 w-auto object-contain"
          />
        ) : (
          <p className="font-grotesk text-2xl font-bold text-bone">{theme.appName}</p>
        )}
        {theme.loginHeadline && (
          <h1 className="mt-1 font-grotesk text-xl font-semibold text-bone">
            {theme.loginHeadline}
          </h1>
        )}
        {theme.loginSubhead && (
          <p className="max-w-sm text-sm leading-relaxed text-steel">{theme.loginSubhead}</p>
        )}
        {/* Their door, our engine. Not removable. */}
        <PoweredByPulse className="mt-1" />
      </div>
    </>
  );
}
