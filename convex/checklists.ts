/* ============================================================
   Pre + post session checklists.
   Auto-staged on session.create. Pre-checklist evaporates if the
   session is cancelled before it runs; post-checklist stays as a
   record of what got done after a completed session.

   Alert delivery reuses the existing `insights` table so the bell
   in the topbar surfaces "Pre-session checklist ready" and
   "Post-session checklist ready" with one click into the session.
   ============================================================ */
import { v } from "convex/values";
import { query, mutation, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import {
  newPreChecklistItems,
  newPostChecklistItems,
} from "./lib/checklistTemplates";

/** Both checklists for a session (always two rows once seeded). */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("sessionChecklists")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const filtered = rows.filter((r) => r.orgId === orgId);
    return {
      pre: filtered.find((r) => r.kind === "pre") ?? null,
      post: filtered.find((r) => r.kind === "post") ?? null,
    };
  },
});

/** Toggle one item by index. doneByName lets us attribute the check
 * without a full user record (Pulse's demo mode is single-org). */
export const toggleItem = mutation({
  args: {
    id: v.id("sessionChecklists"),
    index: v.number(),
    doneByName: v.optional(v.string()),
  },
  handler: async (ctx, { id, index, doneByName }) => {
    const orgId = await currentOrg(ctx);
    const cl = await ctx.db.get(id);
    if (!cl || cl.orgId !== orgId) throw new Error("Not found");
    if (index < 0 || index >= cl.items.length) throw new Error("Bad index");
    const items = cl.items.slice();
    const cur = items[index];
    const nextDone = !cur.done;
    items[index] = {
      ...cur,
      done: nextDone,
      doneByName: nextDone ? doneByName : undefined,
      doneAt: nextDone ? Date.now() : undefined,
    };
    await ctx.db.patch(id, { items });
  },
});

/* ============================================================
   Helpers consumed by session lifecycle hooks in convex/sessions.ts.
   Exposed as plain functions (not Convex functions) since they
   only run inside a MutationCtx already.
   ============================================================ */

/** Insert both pre + post checklists for a new session. */
export async function stageChecklistsFor(
  ctx: MutationCtx,
  args: {
    orgId: string;
    sessionId: Id<"sessions">;
    roomId?: Id<"rooms">;
  },
): Promise<void> {
  await ctx.db.insert("sessionChecklists", {
    orgId: args.orgId,
    sessionId: args.sessionId,
    roomId: args.roomId,
    kind: "pre",
    items: newPreChecklistItems(),
  });
  await ctx.db.insert("sessionChecklists", {
    orgId: args.orgId,
    sessionId: args.sessionId,
    roomId: args.roomId,
    kind: "post",
    items: newPostChecklistItems(),
  });
}

/** Drop the pre-checklist when a session is cancelled before it runs.
 * Post-checklist stays if any items were already ticked (e.g. cancel
 * after a partial completion). */
export async function dropPreChecklistFor(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
): Promise<void> {
  const rows = await ctx.db
    .query("sessionChecklists")
    .withIndex("by_session_kind", (q) => q.eq("sessionId", sessionId).eq("kind", "pre"))
    .collect();
  for (const r of rows) {
    const everDone = r.items.some((i) => i.done);
    if (!everDone) await ctx.db.delete(r._id);
  }
}
