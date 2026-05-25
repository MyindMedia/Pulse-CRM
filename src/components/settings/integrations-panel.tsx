"use client";

import { StripeConnectCard } from "@/components/payments/stripe-connect-card";
import { EmailConnectCard } from "@/components/email/email-connect-card";

/** Studio integrations — connect Stripe to collect deposits and choose how
 *  client email is sent (internal Pulse or your own Google account). */
export function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-base font-semibold text-bone">Payments</h2>
        <p className="text-sm text-ash">Connect Stripe so clients pay deposits straight into your account.</p>
      </div>
      <StripeConnectCard />

      <div className="pt-2">
        <h2 className="font-display text-base font-semibold text-bone">Client email</h2>
        <p className="text-sm text-ash">Send booking + client messages from Pulse, or from your own Gmail.</p>
      </div>
      <EmailConnectCard />
    </div>
  );
}
