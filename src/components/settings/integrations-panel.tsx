"use client";

import { StripeConnectCard } from "@/components/payments/stripe-connect-card";
import { EmailConnectCard } from "@/components/email/email-connect-card";
import { SmsRemindersCard } from "@/components/sms/sms-reminders-card";

/** Studio integrations - connect Stripe to collect deposits, choose how client
 *  email is sent, and control automated text reminders. */
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

      <div className="pt-2">
        <h2 className="font-display text-base font-semibold text-bone">Text messages</h2>
        <p className="text-sm text-ash">Automated session reminders by SMS to clients and engineers.</p>
      </div>
      <SmsRemindersCard />
    </div>
  );
}
