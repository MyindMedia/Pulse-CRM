import { safeHttpUrl, usd } from "./format";

/* What the locked client page says (R3-05). The server offers a Pay link only
   when that link charges exactly the amount shown (payTargetFor); otherwise
   payUrl is null and the page says the studio will send a way to pay. A
   booking with hidden prices has balanceCents null: no figure anywhere. */

export type LockCopy = { heading: string; body: string; payUrl: string | null };

export function lockCopy(input: { studioName: string; balanceCents: number | null; payUrl: string | null | undefined }): LockCopy {
  const payUrl = safeHttpUrl(input.payUrl);
  const studio = input.studioName.trim() || "The studio";
  const heading =
    input.balanceCents === null
      ? "Your files are ready once the balance is paid"
      : input.balanceCents > 0
        ? `Pay ${usd(input.balanceCents)} to unlock your files`
        : "Pay to unlock your files";
  const body = payUrl
    ? "Downloads open on this page as soon as the payment goes through."
    : `${studio} will send you a way to pay. Your files unlock here as soon as it is paid.`;
  return { heading, body, payUrl };
}
