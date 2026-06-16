"use client";

import * as React from "react";
import { Loader2, Lock } from "lucide-react";
import { useCapabilities } from "@/lib/use-capabilities";

/**
 * Gate a whole page behind a capability. Renders a spinner while caps load, a
 * friendly "no access" panel if the viewer's role lacks `cap`, otherwise the
 * children. This is the UX twin of the server guard - the queries on the page
 * already enforce the same capability, so this just avoids a wall of errors for
 * a role that shouldn't be here.
 */
export function CapabilityGuard({
  cap,
  title = "You don't have access to this",
  children,
}: {
  cap: string;
  title?: string;
  children: React.ReactNode;
}) {
  const { can, loaded } = useCapabilities();

  if (!loaded) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    );
  }

  if (!can(cap)) {
    return (
      <div className="grid min-h-[50vh] place-items-center px-4 text-center">
        <div className="max-w-sm space-y-3">
          <span className="mx-auto grid size-12 place-items-center rounded-lg border border-graphite/60 bg-coal-2 text-steel">
            <Lock className="size-5" />
          </span>
          <h1 className="font-grotesk text-lg font-semibold text-bone">{title}</h1>
          <p className="text-sm text-steel">
            This area is limited to studio leadership. If you need access, ask an owner or
            manager to update your role.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
