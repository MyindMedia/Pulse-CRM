"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StripeConnectInstance } from "@stripe/connect-js";
import { ConnectComponentsProvider, ConnectAccountOnboarding } from "@stripe/react-connect-js";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";

/**
 * Embedded Stripe Connect onboarding - the studio completes Express onboarding
 * INSIDE Pulse (themed to brand) instead of being redirected to Stripe's hosted
 * flow. Requires NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; callers fall back to the
 * hosted Account Link when this is unavailable.
 */
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/** True when embedded onboarding can run (publishable key configured). */
export const embeddedConnectAvailable = Boolean(PUBLISHABLE_KEY);

// Brand-tuned appearance for the embedded component (Pulse gold on coal).
const APPEARANCE = {
  variables: {
    colorPrimary: "#fdb913",
    colorBackground: "#141417",
    colorText: "#f6f6f5",
    colorSecondaryText: "#a3a3ad",
    colorBorder: "#2b2b32",
    colorDanger: "#f87171",
    buttonPrimaryColorBackground: "#fdb913",
    buttonPrimaryColorBorder: "#fdb913",
    buttonPrimaryColorText: "#241900",
    formAccentColor: "#fdb913",
    borderRadius: "10px",
    fontFamily: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
    overlayBackdropColor: "rgba(8, 8, 10, 0.7)",
  },
} as const;

export function EmbeddedConnectOnboarding({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the studio exits the embedded flow (finished or closed). */
  onComplete: () => void;
}) {
  const createAccountSession = useAction(api.stripeConnect.createAccountSession);
  const [instance, setInstance] = React.useState<StripeConnectInstance | null>(null);
  const [failed, setFailed] = React.useState(false);

  // Keep the latest action without re-initialising the Connect instance.
  const fetchRef = React.useRef(createAccountSession);
  React.useEffect(() => {
    fetchRef.current = createAccountSession;
  }, [createAccountSession]);

  React.useEffect(() => {
    if (!open || !PUBLISHABLE_KEY || instance) return;
    let cancelled = false;
    // Browser-only: dynamic import keeps ConnectJS off the SSR/build path.
    void (async () => {
      try {
        const { loadConnectAndInitialize } = await import("@stripe/connect-js");
        const inst = loadConnectAndInitialize({
          publishableKey: PUBLISHABLE_KEY,
          fetchClientSecret: async () => {
            const { clientSecret } = await fetchRef.current({});
            return clientSecret;
          },
          appearance: APPEARANCE,
        });
        if (!cancelled) setInstance(inst);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, instance]);

  function handleExit() {
    onComplete();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[88vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Connect your payouts</DialogTitle>
        </DialogHeader>
        <DialogBody className="max-h-[72vh] overflow-y-auto">
          {failed ? (
            <p className="py-8 text-center text-sm text-steel">
              Could not load the secure onboarding. Please try again.
            </p>
          ) : instance ? (
            <ConnectComponentsProvider connectInstance={instance}>
              <ConnectAccountOnboarding onExit={handleExit} />
            </ConnectComponentsProvider>
          ) : (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-steel">
              <Loader2 className="size-4 animate-spin" /> Loading secure onboarding…
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
