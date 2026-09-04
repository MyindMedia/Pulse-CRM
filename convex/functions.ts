/* Mutation constructors that keep the native-client change feed honest.
 *
 * Every mutation in this codebase must be defined with the `mutation` and
 * `internalMutation` exported here rather than the raw ones from
 * `_generated/server`. The wrapper swaps `ctx.db` for a writer that fires
 * triggers, and the trigger below appends to `changeLog` on every insert,
 * update and delete of a mirrored table.
 *
 * This is why Pulse can serve a delta feed at all. The alternative was stamping
 * `updatedAt` across 1,618 `ctx.db` call sites in 90 tables that mostly do not
 * have the field.
 *
 * KNOWN GAP, on purpose: triggers do not fire for rows edited in the Convex
 * dashboard or written by `npx convex import`. Such a row will not reach a
 * client until something changes it through a mutation. If that ever matters,
 * the fix is a reconciling sweep, not a trigger.
 */
import {
  mutation as rawMutation,
  internalMutation as rawInternalMutation,
} from "./_generated/server";
import type { DataModel } from "./_generated/dataModel";
import { Triggers } from "convex-helpers/server/triggers";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { MIRRORED_TABLES } from "./lib/mirroredTables";

const triggers = new Triggers<DataModel>();

for (const table of MIRRORED_TABLES) {
  triggers.register(table, async (ctx, change) => {
    // On a delete the new document is gone, so the org comes off the old one.
    const doc = change.newDoc ?? change.oldDoc;
    const orgId = (doc as { orgId?: string } | null)?.orgId;
    // A row with no org cannot be routed to a studio's mirror. Skipping it is
    // correct: the client is never entitled to it in the first place.
    if (!orgId) return;

    // innerDb, not db: writing through the wrapped writer would re-enter the
    // trigger machinery for a table nobody mirrors.
    await ctx.innerDb.insert("changeLog", {
      orgId,
      tableName: table,
      docId: change.id,
      op: change.operation === "update" ? "update" : change.operation,
      ts: Date.now(),
    });
  });
}

export const mutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
export const internalMutation = customMutation(
  rawInternalMutation,
  customCtx(triggers.wrapDB),
);
