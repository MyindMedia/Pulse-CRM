"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { useUser, SignUp } from "@clerk/nextjs";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { errorMessage } from "@/lib/errors";

const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Post-payment activation: confirm the paid checkout, then create the Clerk
 *  login (email prefilled) and link it to the subscription. */
function Activate() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id") ?? "";
  const summary = useAction(api.billing.checkoutSummary);
  const claim = useAction(api.billing.claimCheckout);
  const { isLoaded, isSignedIn } = useUser();

  const [info, setInfo] = React.useState<{ email: string | null; paid: boolean } | null>(null);
  const [err, setErr] = React.useState("");
  const claimedRef = React.useRef(false);

  // Load the paid session (prefill email + confirm payment).
  React.useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    summary({ sessionId })
      .then((s) => {
        if (!cancelled) setInfo({ email: s.email, paid: s.paid });
      })
      .catch(() => {
        if (!cancelled) setErr("We could not load your checkout. Please contact support.");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, summary]);

  // Once the buyer has created their login, link it to the subscription.
  React.useEffect(() => {
    if (!isLoaded || !isSignedIn || !sessionId || claimedRef.current) return;
    claimedRef.current = true;
    claim({ sessionId })
      .then(() => router.replace("/agency"))
      .catch((e) => {
        setErr(errorMessage(e));
        claimedRef.current = false;
      });
  }, [isLoaded, isSignedIn, sessionId, claim, router]);

  const activationUrl = `/welcome/activate?session_id=${sessionId}`;

  return (
    <div className="relative grid min-h-dvh place-items-center bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: "radial-gradient(60% 40% at 50% 25%, rgba(253,185,19,0.1), transparent 70%)",
        }}
      />
      <div className="relative flex w-full max-w-md flex-col items-center gap-6 text-center">
        <PulseLogo size="lg" asLink={false} />

        {!sessionId ? (
          <p className="text-sm text-ash">Missing checkout reference. Please subscribe from the pricing page.</p>
        ) : isSignedIn ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-gold" />
            <h1 className="font-display text-2xl font-bold text-bone">Setting up your studio…</h1>
            <p className="text-sm text-ash">Linking your subscription and getting your workspace ready.</p>
            {err && <p className="text-sm text-critical">{err}</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <CheckCircle2 className="size-8 text-positive" />
              <h1 className="font-display text-2xl font-bold text-bone">Payment received</h1>
              <p className="text-sm text-ash">
                Create your login to finish setting up
                {info?.email ? ` (${info.email})` : ""}.
              </p>
            </div>
            <SignUp
              appearance={clerkAppearance}
              initialValues={info?.email ? { emailAddress: info.email } : undefined}
              forceRedirectUrl={activationUrl}
              signInUrl="/sign-in"
            />
            {err && <p className="text-sm text-critical">{err}</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default function ActivatePage() {
  if (!CLERK_ENABLED) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink p-6 text-center">
        <p className="text-sm text-ash">
          Account activation requires Clerk to be configured.
        </p>
      </div>
    );
  }
  return (
    <React.Suspense fallback={null}>
      <Activate />
    </React.Suspense>
  );
}
