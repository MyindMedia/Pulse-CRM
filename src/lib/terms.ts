/* ============================================================
   Pulse Terms of Service - shown (and gated) during onboarding.
   The Payments section mirrors the actual Stripe Connect
   architecture: each studio operates its OWN Stripe Express
   connected account; charges run directly on that account; the
   platform never holds, controls, or transmits client funds.
   Bump TERMS_VERSION when this text changes - studios re-accept.
   ============================================================ */

export const TERMS_VERSION = "2026-06-12.1";

export const TERMS_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "1. The service",
    body: [
      "Pulse is studio-management software operated by Myind Sound (\"Pulse\", \"we\", \"us\"). It provides booking pages, scheduling, client and team management, inventory, invoicing, messaging, and related tools for recording studios and creative spaces (each a \"Studio\", \"you\").",
      "By creating an account, completing onboarding, or using the service, you agree to these Terms on behalf of the Studio you represent and confirm you have authority to do so.",
    ],
  },
  {
    title: "2. Your account",
    body: [
      "You are responsible for the accuracy of the information you provide, for safeguarding your login credentials, and for all activity under your workspace, including team members you invite. Notify us promptly of any unauthorized access.",
    ],
  },
  {
    title: "3. Payments and Stripe Connect",
    body: [
      "All card payments in Pulse are processed exclusively by Stripe, Inc. (\"Stripe\"). To accept payments, your Studio creates its own Stripe connected account and must accept the Stripe Connected Account Agreement, which includes the Stripe Terms of Service. Your relationship for payment processing is directly with Stripe.",
      "Client charges (deposits, balances, invoices, memberships) are created directly on YOUR Stripe connected account. Your Studio is the merchant of record for every transaction with your clients. Funds settle from Stripe to the bank account you connect with Stripe. Pulse never holds, controls, custodies, or transmits your funds or your clients' funds at any time.",
      "Stripe is solely responsible for payment processing, settlement, payouts, and the security of payment credentials. PULSE IS NOT RESPONSIBLE OR LIABLE FOR ANY MONEY TRANSACTION OR PAYMENT-PROCESSING MATTER, including without limitation: processing errors or delays, declined or failed payments, payout timing, account holds, reserves or frozen funds, chargebacks, refunds, disputes, or Stripe's decisions about your connected account. Those matters are between you, your client, and Stripe, and Stripe holds that liability under its own agreements.",
      "You are responsible for handling refunds and disputes with your clients through your own Stripe account, for any fees Stripe charges, and for all taxes related to your sales. Stripe may require identity, business, and banking information from you (\"KYC\") and may suspend or restrict your connected account under its own policies - Pulse has no control over those decisions.",
      "Subscription fees for Pulse itself are billed separately through Stripe at the plan and price shown when you subscribe.",
    ],
  },
  {
    title: "4. Your content and your clients",
    body: [
      "You own the content you upload (logos, photos, client records, notes). You grant Pulse a limited license to host and display it solely to operate the service - for example, showing your logo and rooms on your public booking page.",
      "You are responsible for your relationships with your clients: honoring bookings, your cancellation and deposit policies, and complying with the laws that apply to your business, including how you collect and use client contact information.",
    ],
  },
  {
    title: "5. AI-assisted features",
    body: [
      "Pulse includes AI-assisted features such as generated brand imagery, drafted messages, and operational insights. AI output can be imperfect - review it before relying on it or sending it to clients. You are responsible for what you publish and send.",
    ],
  },
  {
    title: "6. Acceptable use",
    body: [
      "Do not use Pulse for anything unlawful, to send spam, to infringe others' rights, or to probe or disrupt the service. We may suspend accounts that put the platform, other studios, or their clients at risk.",
    ],
  },
  {
    title: "7. Availability and changes",
    body: [
      "We work to keep Pulse fast and available, but the service is provided \"as is\" and \"as available\", without warranties of any kind, express or implied. We may add, change, or remove features, and we may update these Terms - if we do, we will ask you to review and accept the new version.",
    ],
  },
  {
    title: "8. Limitation of liability",
    body: [
      "To the maximum extent permitted by law, Pulse and Myind Sound will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, data, or goodwill. Our total liability for any claim relating to the service is limited to the subscription fees you paid to Pulse in the twelve months before the event giving rise to the claim. For clarity and without limiting Section 3, Pulse has no liability for payment transactions processed by Stripe.",
    ],
  },
  {
    title: "9. Termination",
    body: [
      "You may stop using Pulse at any time. We may suspend or terminate access for breach of these Terms. After termination you can request an export of your data within 30 days; your Stripe account and its funds remain yours and are unaffected by Pulse account status.",
    ],
  },
  {
    title: "10. Contact",
    body: [
      "Questions about these Terms: support@myindsound.com. These Terms are governed by the laws of the State of California, USA.",
    ],
  },
];
