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
import { ConvexError } from "convex/values";
import { Triggers } from "convex-helpers/server/triggers";
import {
  customCtx,
  customMutation,
} from "convex-helpers/server/customFunctions";
import { MIRRORED_TABLES } from "./lib/mirroredTables";
import { AUDITED_TABLES, auditEntry } from "./lib/changeAudit";

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

/* The change log owners and managers read (lib/changeAudit.ts). A second
   trigger on the same writes, recording who made each change and what it
   touched. Signed-in writes only: scheduled jobs are not people. */
for (const table of AUDITED_TABLES) {
  triggers.register(table, async (ctx, change) => {
    const entry = await auditEntry(ctx, table, change as never);
    if (entry) await ctx.innerDb.insert("changeAudit", entry);
  });
}

/* Refusals say why, in production too.
 *
 * A production deployment hides the text of a plain thrown Error from every
 * client and sends "Server Error" in its place, and most refusals in this
 * codebase are plain Errors written for people ("This booking is already paid
 * in full."). The phone filed "Server Error" as the reason a write was refused,
 * which reads like a blip and invited retries that could never work. A
 * ConvexError's data does reach the client, so a plain Error thrown by a
 * handler leaves as one, with the same words. Anything already a ConvexError
 * (AccessError and its codes, plan limits) passes through untouched, and so do
 * TypeError and the like: those are bugs, not refusals, and stay in the logs.
 * Actions are not covered here; they are not queued by the apps. */
function sayWhy<T>(definition: T): T {
  const wrap =
    (handler: (...args: never[]) => unknown) =>
    async (...args: never[]) => {
      try {
        return await handler(...args);
      } catch (err) {
        if (err instanceof Error && !(err instanceof ConvexError) && err.constructor === Error) {
          throw new ConvexError(err.message);
        }
        throw err;
      }
    };
  if (typeof definition === "function") return wrap(definition as never) as T;
  const d = definition as { handler: (...args: never[]) => unknown };
  return { ...d, handler: wrap(d.handler) } as T;
}

const triggeredMutation = customMutation(rawMutation, customCtx(triggers.wrapDB));
const triggeredInternalMutation = customMutation(rawInternalMutation, customCtx(triggers.wrapDB));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mutation = ((definition: any) => triggeredMutation(sayWhy(definition))) as typeof triggeredMutation;
export const internalMutation = ((definition: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
  triggeredInternalMutation(sayWhy(definition))) as typeof triggeredInternalMutation;
