"use client";

import { StripeConnectCard } from "@/components/payments/stripe-connect-card";
import { EmailConnectCard } from "@/components/email/email-connect-card";
import { CalendarSyncCard } from "@/components/calendar/calendar-sync-card";
import { SmsRemindersCard } from "@/components/sms/sms-reminders-card";
import { PlaidConnectCard } from "@/components/finance/plaid-connect-card";

/** Connect the studio's payments, banking, messaging, and calendar services. */
export function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-grotesk text-base font-semibold text-bone">Payments</h2>
        <p className="text-sm text-steel">Connect Stripe so clients pay deposits straight into your account.</p>
      </div>
      <StripeConnectCard />

      <div className="pt-2">
        <h2 className="font-grotesk text-base font-semibold text-bone">Banking</h2>
        <p className="text-sm text-steel">Connect your bank with Plaid to keep studio finances up to date.</p>
      </div>
      <PlaidConnectCard />

      <div className="pt-2">
        <h2 className="font-grotesk text-base font-semibold text-bone">Client email</h2>
        <p className="text-sm text-steel">Send booking + client messages from Pulse, or from your own Gmail.</p>
      </div>
      <EmailConnectCard />

      <div className="pt-2">
        <h2 className="font-grotesk text-base font-semibold text-bone">Calendar</h2>
        <p className="text-sm text-steel">Two-way sync with your Google calendar once your account is connected.</p>
      </div>
      <CalendarSyncCard />

      <div className="pt-2">
        <h2 className="font-grotesk text-base font-semibold text-bone">Text messages</h2>
        <p className="text-sm text-steel">Automated session reminders by SMS to clients and engineers.</p>
      </div>
      <SmsRemindersCard />
    </div>
  );
}
