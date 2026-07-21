import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalShell,
  Section,
  LEGAL_ENTITY,
  LEGAL_EMAIL,
  LEGAL_ADDRESS,
} from "@/components/marketing/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy | Pulse",
  description:
    "How Myind Media LLC collects, uses, and protects personal information in Pulse, including SMS/text messaging data.",
  alternates: { canonical: "/privacy" },
};

/* Static: carrier/TCR reviewers fetch this signed-out and unauthenticated. */
export const dynamic = "force-static";

export default function PrivacyPolicy() {
  return (
    <LegalShell title="Privacy Policy" updated="July 21, 2026">
      <Section heading="Who we are">
        <p>
          Pulse is recording studio management software operated by {LEGAL_ENTITY} (&ldquo;Pulse&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;), {LEGAL_ADDRESS}. This policy explains what personal
          information we collect, why we collect it, and the choices you have. It covers
          pulse.myindsound.com and the studio booking pages we host on behalf of our customers.
        </p>
      </Section>

      <Section heading="Information we collect">
        <p>We collect only what is needed to run a studio&rsquo;s bookings and communications:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-mist">Contact details</strong> — name, email address, and mobile
            phone number, provided by you when you book a session, accept a staff invitation, or
            create an account.
          </li>
          <li>
            <strong className="text-mist">Booking information</strong> — sessions, rooms, times,
            add-ons, and related notes.
          </li>
          <li>
            <strong className="text-mist">Payment information</strong> — processed by Stripe. We do
            not store full card numbers on our systems.
          </li>
          <li>
            <strong className="text-mist">Technical data</strong> — IP address, device and browser
            type, and log data used to keep the service secure and working.
          </li>
        </ul>
      </Section>

      <Section heading="How we use your information">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To create, confirm, change, and remind you about studio bookings.</li>
          <li>To send account and service notifications you have asked to receive.</li>
          <li>To take payment and issue invoices and receipts.</li>
          <li>To provide customer support and respond to your enquiries.</li>
          <li>To secure the service, prevent abuse, and meet our legal obligations.</li>
        </ul>
      </Section>

      <Section heading="SMS and text messaging">
        <p>
          If you provide your mobile number and opt in, we send transactional text messages such as
          appointment reminders, booking confirmations, schedule changes, and account notifications.
          Message frequency varies with your booking activity. Message and data rates may apply.
        </p>
        <p>
          Reply <strong className="text-mist">STOP</strong> to any message to opt out at any time, or{" "}
          <strong className="text-mist">HELP</strong> for assistance. Full program terms are in our{" "}
          <Link href="/terms" className="text-gold hover:underline">
            Terms of Service
          </Link>
          .
        </p>
        <p className="border-l-2 border-gold/60 pl-4 text-mist">
          No mobile information will be shared with third parties or affiliates for marketing or
          promotional purposes. Information sharing to subcontractors in support services, such as
          customer service, is permitted. All other use case categories exclude text messaging
          originator opt-in data and consent; this information will not be shared with any third
          parties.
        </p>
      </Section>

      <Section heading="How we share information">
        <p>
          We do not sell your personal information, and we do not rent or trade it. We share it only
          with service providers who process it on our behalf under contract, and only as needed to
          deliver the service:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Twilio — delivery of SMS messages.</li>
          <li>Stripe — payment processing.</li>
          <li>Clerk — account authentication.</li>
          <li>Convex and Netlify — application hosting and data storage.</li>
        </ul>
        <p>
          We may also disclose information where required by law, or to protect the rights, safety,
          and property of {LEGAL_ENTITY}, our customers, or the public.
        </p>
        <p>
          Where a recording studio uses Pulse to manage its own clients, that studio is the
          controller of its client data and we process it on the studio&rsquo;s instructions.
        </p>
      </Section>

      <Section heading="Data retention">
        <p>
          We keep personal information for as long as your account is active and thereafter only as
          long as needed for the purposes described here, to resolve disputes, and to meet legal,
          tax, and accounting requirements. You may ask us to delete your data at any time.
        </p>
      </Section>

      <Section heading="Your rights and choices">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Opt out of text messages at any time by replying STOP.</li>
          <li>Unsubscribe from email using the link in any message.</li>
          <li>Request a copy of the personal information we hold about you.</li>
          <li>Ask us to correct information that is inaccurate.</li>
          <li>Ask us to delete your personal information.</li>
        </ul>
        <p>
          To exercise any of these, email{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-gold hover:underline">
            {LEGAL_EMAIL}
          </a>
          . We respond within 30 days.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          We protect personal information with encryption in transit, access controls, and
          least-privilege practices for staff access. No method of transmission or storage is
          completely secure, so we cannot guarantee absolute security.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          Pulse is not directed at children under 13, and we do not knowingly collect their personal
          information. If you believe a child has provided us information, contact us and we will
          delete it.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will be reflected in the
          &ldquo;last updated&rdquo; date above, and where appropriate we will notify you directly.
        </p>
      </Section>

      <Section heading="Contact us">
        <p>
          Questions about this policy or your data? Email{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-gold hover:underline">
            {LEGAL_EMAIL}
          </a>{" "}
          or write to {LEGAL_ENTITY}, {LEGAL_ADDRESS}.
        </p>
      </Section>
    </LegalShell>
  );
}
