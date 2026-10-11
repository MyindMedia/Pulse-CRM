"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { Disc3 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCapabilities } from "@/lib/use-capabilities";
import { DEMO_ORG } from "@convex/lib/tier";

/* An agency operator who has not entered a sub-account belongs in the agency
   console. The server answers that case with the demo workspace ("Pulse
   Studio", kept only for the App Store review logins), so without this the
   operator landed in fake data that looked like a real studio. Studio members
   are never redirected: the review logins live in the demo on purpose. */
export function AgencyHomeRedirect({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { kind } = useCapabilities();
  const org = useQuery(api.orgs.current);
  const toConsole = kind === "agency_member" && org?.orgId === DEMO_ORG;

  React.useEffect(() => {
    if (toConsole) router.replace("/agency");
  }, [toConsole, router]);

  if (toConsole) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink">
        <div className="flex flex-col items-center gap-3">
          <Disc3 className="size-8 animate-spin text-gold" aria-hidden />
          <p className="font-meta text-xs uppercase tracking-[0.2em] text-steel/70">
            Opening the agency console
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
