import type { MutationCtx } from "../_generated/server";
import { ensureOrgBuckets } from "./media";

/* Every new studio gets its own R2 buckets, whichever path created it (agency
   console, beta invite, self-serve signup, onboarding, the demo stager, anything
   added later). Registered as a trigger on the `orgs` table in functions.ts, so a
   creation path cannot forget it. The work itself is scheduled, never done inline:
   a Cloudflare outage must not block a studio from signing up. If provisioning
   fails the studio stays `pending`, uploads use the shared bucket meanwhile, and
   the hourly sweep (orgBuckets.sweepNewOrgs) retries. */
export async function provisionOnOrgInsert(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  change: { operation: string; newDoc?: { orgId?: string } | null },
): Promise<void> {
  if (change.operation !== "insert") return;
  const orgId = change.newDoc?.orgId;
  if (!orgId) return;
  await ensureOrgBuckets(ctx as MutationCtx, orgId);
}
