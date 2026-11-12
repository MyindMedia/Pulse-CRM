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

/* How the room (or the service, which inherits the room's payment mode) takes
   money. Deposit settings are per room, so the room and service pages pass it;
   the studio-wide page has no room and gets wording that holds for any room. */
export type RoomPayCfg = { paymentMode?: "deposit" | "full"; depositPct?: number };

type PayKind = "deposit" | "full" | "none" | "any";

function payKind(room: RoomPayCfg | undefined): PayKind {
  if (!room) return "any";
  if (room.paymentMode === "full") return "full";
  return (room.depositPct ?? 30) <= 0 ? "none" : "deposit";
}

export const DEFAULT_DEPOSIT_LINE =
  "A deposit holds your slot and counts toward your total. Pay the balance at least 2 hours before your session, or the booking is released and the deposit is kept.";
/* paymentMode "full": the whole price is paid to confirm; there is no balance. */
export const FULL_PAY_LINE = "Payment in full confirms your booking.";
/* depositPct 0: booked with nothing up front; only the 2h balance rule applies. */
export const NO_DEPOSIT_LINE =
  "No deposit is needed. Pay the balance at least 2 hours before your session, or the booking is released.";
/* No room in view: true for deposit, 0% and paid-in-full rooms alike. */
export const STUDIO_WIDE_LINE =
  "Pay in full at least 2 hours before your session, or the booking is released and anything already paid is kept.";

export function cancellationLine(org: PolicyOrg | null | undefined, room?: RoomPayCfg): string {
  const feePct = Math.min(Math.max(org?.cancellationFeePct ?? 0, 0), 100);
  const windowH = Math.max(org?.cancellationWindowHours ?? 0, 0);
  const when = windowH > 0
    ? `If you cancel within ${windowH} ${windowH === 1 ? "hour" : "hours"} of the start or do not show up`
    : "If you do not show up";
  const kind = payKind(room);
  // A 0% room holds no deposit, so there is nothing to keep, only the fee.
  if (kind === "none") return feePct > 0 ? `${when}, a fee of ${feePct}% of the booking applies.` : "";
  // A paid-in-full room's "deposit" is the whole payment.
  const kept = kind === "full" ? "the payment" : "the deposit";
  return feePct > 0
    ? `${when}, ${kept} is kept and a fee of ${feePct}% of the booking applies (${kept} counts toward it).`
    : `${when}, ${kept} is kept.`;
}

function defaultPayLine(room: RoomPayCfg | undefined): string {
  const kind = payKind(room);
  if (kind === "full") return FULL_PAY_LINE;
  if (kind === "none") return NO_DEPOSIT_LINE;
  if (kind === "deposit") return DEFAULT_DEPOSIT_LINE;
  return STUDIO_WIDE_LINE;
}

export function clientPolicyText(org: PolicyOrg | null | undefined, room?: RoomPayCfg): string {
  const custom = org?.depositPolicyText?.trim();
  const hasCancelRule = (org?.cancellationFeePct ?? 0) > 0 || (org?.cancellationWindowHours ?? 0) > 0;
  const cancel = cancellationLine(org, room);
  if (!custom) return cancel ? `${defaultPayLine(room)} ${cancel}` : defaultPayLine(room);
  return hasCancelRule && cancel ? `${custom} ${cancel}` : custom;
}
