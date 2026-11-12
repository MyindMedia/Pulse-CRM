import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";

/* Where a client lands after paying (or backing out of) a prepaid-hours pay
   link. Public, no sign-in, no data read: the hours are added by the Stripe
   webhook, not by this page, so the page only says what happens next. The
   `studio` slug only builds the "book a session" link. */

export const metadata: Metadata = {
  title: "Prepaid hours",
  robots: { index: false, follow: false },
};

export default async function PackagePaidPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const rawSlug = typeof sp.studio === "string" ? sp.studio : "";
  const slug = /^[a-z0-9-]{1,80}$/i.test(rawSlug) ? rawSlug : "";
  const paid = status === "paid";

  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-6">
      <div className="relative w-full max-w-md rounded-chrome border border-graphite/50 bg-coal/60 p-6 text-center shadow-elev-2">
        {paid ? (
          <>
            <CheckCircle2 className="mx-auto size-8 text-positive" />
            <p className="mt-2 font-grotesk text-lg font-semibold text-bone">Payment received</p>
            <p className="mt-1 text-sm text-steel">
              Thank you. Your prepaid hours are added to your account with the studio as soon as the payment
              is confirmed, usually within a minute. The studio takes hours off them as you use your sessions.
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto size-8 text-steel" />
            <p className="mt-2 font-grotesk text-lg font-semibold text-bone">No payment was taken</p>
            <p className="mt-1 text-sm text-steel">
              You left the checkout before paying, so nothing was charged. Ask the studio for a new link if you
              still want the hours.
            </p>
          </>
        )}
        {slug && (
          <a
            href={`/book/${slug}`}
            className="mt-5 inline-flex w-full items-center justify-center rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Book a session
          </a>
        )}
      </div>
    </div>
  );
}
