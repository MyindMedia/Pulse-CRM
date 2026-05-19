import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveViewer, requireCapability, AccessError } from "./lib/access";

/* ============================================================
   Test harness — referenced only by *.test.ts files via convex-test.
   These run inside the test sandbox; safe to leave deployed.
   ============================================================ */

export const resolve = query({
  args: {},
  handler: async (ctx) => {
    const v = await resolveViewer(ctx);
    return {
      kind: v.kind,
      role: (v as { role?: string }).role,
      orgId: (v as { orgId?: string }).orgId,
      caps: [...v.capabilities].sort(),
    };
  },
});

export const require_ = mutation({
  args: { cap: v.string(), orgId: v.optional(v.string()) },
  handler: async (ctx, { cap, orgId }) => {
    try {
      const viewer = await requireCapability(ctx, cap, { orgId });
      return { ok: true as const, kind: viewer.kind };
    } catch (e) {
      if (e instanceof AccessError) return { ok: false as const, code: e.code };
      throw e;
    }
  },
});
