"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { PoweredByPulse } from "@/components/brand/powered-by-pulse";
import { cn } from "@/lib/utils";

/**
 * The mark at the top of the app rail.
 *
 * On the Label tier the studio's own logo takes over the whole lockup, with
 * the Powered by Pulse line underneath it. Every tier below renders the Pulse
 * wordmark unchanged. Falling back to the wordmark while the queries load
 * avoids a flash of the wrong brand.
 */
export function BrandLockup({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const org = useQuery(api.orgs.current);
  const theme = useQuery(api.theme.get);

  const whiteLabeled = theme?.active === true;
  const logoUrl = org?.logoUrl ?? null;
  const name = theme?.appName || org?.name || "Pulse";

  if (collapsed) {
    return (
      <div className={cn("flex flex-col items-center gap-1", className)}>
        {whiteLabeled && logoUrl ? (
          <img
            src={logoUrl}
            alt={name}
            className="size-8 rounded-md object-contain"
            draggable={false}
          />
        ) : (
          <img
            src="/icon-192.png"
            alt="Pulse"
            className="size-8 rounded-md"
            draggable={false}
          />
        )}
        {whiteLabeled && <PoweredByPulse size="xs" href={null} className="text-center" />}
      </div>
    );
  }

  if (whiteLabeled && logoUrl) {
    return (
      <div className={cn("w-2/3", className)}>
        <img
          src={logoUrl}
          alt={name}
          className="block max-h-10 w-auto object-contain"
          draggable={false}
        />
        <PoweredByPulse className="mt-1.5" />
      </div>
    );
  }

  // White-labeled but no logo uploaded yet: show their name, still lock-up'd.
  if (whiteLabeled) {
    return (
      <div className={cn("w-2/3", className)}>
        <p className="font-display text-lg leading-tight text-bone">{name}</p>
        <PoweredByPulse className="mt-1" />
      </div>
    );
  }

  return (
    <div className={cn("w-2/3", className)}>
      <PulseLogo size="full" className="block" />
    </div>
  );
}
