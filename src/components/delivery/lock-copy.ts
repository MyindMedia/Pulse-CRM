import { safeHttpUrl, usd } from "./format";

/* What the locked client page says (Addendum 5, page table). The page points
   at a payment in exactly one case: the exact-match Pay button, which the
   server offers only when that link charges the amount shown (payUrl). In
   every other case the copy names no invoice, no link and no method. A
   booking with hidden prices has balanceCents null: no figure anywhere. */

export type LockCopy = {
  heading: string;
  body: string;
  payUrl: string | null;
  /** False when nothing is owed (nothingOwed): no "Balance due" pill, no Pay button. */
  balanceDue: boolean;
};

export function lockCopy(input: {
  studioName: string;
  balanceCents: number | null;
  payUrl: string | null | undefined;
  /** Locked and nothing is owed: the delivery has not released yet (page.nothingOwed). */
  nothingOwed: boolean;
}): LockCopy {
  const studio = input.studioName.trim() || "The studio";
  if (input.nothingOwed) {
    return {
      heading: "Payment received",
      body: `${studio} is sending your files. This page unlocks as soon as they do.`,
      payUrl: null,
      balanceDue: false,
    };
  }
  // The Pay button needs the amount on the page beside it: with hidden prices
  // there is no exact-match amount to show, so no button.
  const payUrl = input.balanceCents === null ? null : safeHttpUrl(input.payUrl);
  if (payUrl) {
    return {
      heading: `Pay ${usd(input.balanceCents!)} to unlock your files`,
      body: "Downloads open on this page as soon as the payment goes through.",
      payUrl,
      balanceDue: true,
    };
  }
  const body = `${studio} will be in touch about payment. Your files unlock here as soon as the balance is paid.`;
  const heading =
    input.balanceCents === null
      ? "Your files are ready once the balance is paid"
      : `There is a ${usd(input.balanceCents)} balance on this booking`;
  return { heading, body, payUrl: null, balanceDue: true };
}
