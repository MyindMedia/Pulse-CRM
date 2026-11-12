import type { Doc } from "../_generated/dataModel";

/* The booking policy a client sees on the public booking pages. The forfeit
   and no-show emails point back to it, so it has to state the rules the code
   actually enforces:
   - automation.ts step 4: a confirmed booking not paid in full 2 hours before
     the start is released, and what was paid is kept.
   - sessions.ts assessNoShowShield: a no-show, or a cancel inside
     cancellationWindowHours, keeps the deposit and bills cancellationFeePct of
     the booking (the deposit counts toward that fee).
   A studio's own deposit text replaces the default deposit line, but the
   cancellation rule is always added when the studio has one, because the
   no-show email quotes it. */

type PolicyOrg = Pick<Doc<"orgs">, "depositPolicyText" | "cancellationWindowHours" | "cancellationFeePct">;

export const DEFAULT_DEPOSIT_LINE =
  "A deposit holds your slot and counts toward your total. Pay the balance at least 2 hours before your session, or the booking is released and the deposit is kept.";

export function cancellationLine(org: PolicyOrg | null | undefined): string {
  const feePct = Math.min(Math.max(org?.cancellationFeePct ?? 0, 0), 100);
  const windowH = Math.max(org?.cancellationWindowHours ?? 0, 0);
  const when = windowH > 0
    ? `If you cancel within ${windowH} ${windowH === 1 ? "hour" : "hours"} of the start or do not show up`
    : "If you do not show up";
  return feePct > 0
    ? `${when}, the deposit is kept and a fee of ${feePct}% of the booking applies (the deposit counts toward it).`
    : `${when}, the deposit is kept.`;
}

export function clientPolicyText(org: PolicyOrg | null | undefined): string {
  const custom = org?.depositPolicyText?.trim();
  const hasCancelRule = (org?.cancellationFeePct ?? 0) > 0 || (org?.cancellationWindowHours ?? 0) > 0;
  if (!custom) return `${DEFAULT_DEPOSIT_LINE} ${cancellationLine(org)}`;
  return hasCancelRule ? `${custom} ${cancellationLine(org)}` : custom;
}
