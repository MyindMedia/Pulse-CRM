import { IS_STAGING } from "@/lib/deploy-env";

/* A pill on every page of the staging site, so nobody mistakes it for the
   live app. Click-through (pointer-events-none) so it never blocks a control. */
export function StagingBadge() {
  if (!IS_STAGING) return null;
  return (
    <div
      role="note"
      aria-label="Staging site with test data"
      className="pointer-events-none fixed left-1/2 top-1 z-[9999] -translate-x-1/2 rounded-full bg-amber-400 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black shadow-md"
    >
      Staging · test data
    </div>
  );
}
