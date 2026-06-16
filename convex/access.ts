import { query } from "./_generated/server";
import { resolveViewer } from "./lib/access";

/* ============================================================
   Client-facing capability surface. The UI uses this to hide
   nav, figures, and action buttons a role can't use. It is a
   convenience mirror of the server-side policy - every mutation
   and sensitive query still enforces requireCapability on its
   own, so a tampered client can never gain access by lying.
   ============================================================ */

/** The caller's role + capability list for this workspace. Degrades to an
    empty set (no role) rather than throwing, so the shell still renders for a
    viewer the access engine can't resolve (e.g. mid-onboarding). */
export const myCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx).catch(() => null);
    if (!viewer) {
      return { kind: null, role: null, capabilities: [] as string[] };
    }
    return {
      kind: viewer.kind as string | null,
      role: "role" in viewer ? (viewer.role as string) : null,
      capabilities: Array.from(viewer.capabilities) as string[],
    };
  },
});
