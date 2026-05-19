import * as React from "react";

/**
 * Client-side cap guard. Hides children when the viewer's capability
 * set doesn't include `cap`. Server-side gating still lives in Convex.
 */
type Props = {
  viewerCapabilities: Set<string> | string[];
  cap: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function CapGuard({ viewerCapabilities, cap, fallback = null, children }: Props) {
  const set = viewerCapabilities instanceof Set ? viewerCapabilities : new Set(viewerCapabilities);
  if (set.has(cap) || set.has(cap + ".own")) return <>{children}</>;
  return <>{fallback}</>;
}
