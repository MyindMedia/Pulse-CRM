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
  title: "Terms of Service | Pulse",
  description:
    "Terms of Service for Pulse studio management software by Myind Media LLC, including SMS/text messaging program terms.",
  alternates: { canonical: "/terms" },
};

/* Static: carrier/TCR reviewers fetch this signed-out and unauthenticated. */
export const dynamic = "force-static";

export default function TermsOfService() {
  return (
    <LegalShell title="Terms of Service" updated="July 21, 2026">
      <Section heading="Agreement">
        <p>
          These Terms govern your use of Pulse, recording studio management software operated by{" "}
          {LEGAL_ENTITY}, {LEGAL_ADDRESS}. By creating an account, booking a session through a Pulse
          booking page, or opting in to our messages, you agree to these Terms and to our{" "}
          <Link href="/privacy" className="text-gold hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>

      {/*
        The SMS block below is the section carrier / TCR campaign review reads.
        Program description, frequency, rates, STOP/HELP, and carrier liability
        all have to be present and publicly reachable — do not gate this page.
      */}
      <Section heading="SMS / text messaging program">
        <p>
          <strong className="text-mist">Program description.</strong> Pulse sends transactional text
          messages on behalf of recording studios to their clients and staff. Messages include
          appointment and session reminders, booking confirmations, schedule changes, and account
          notifications. We do not send marketing or promotional text messages under this program.
        </p>
        <p>
          <strong className="text-mist">How you opt in.</strong> You provide your mobile number and
          agree to receive texts when you book a session on a studio&rsquo;s Pulse booking page, or
          when you are onboarded as a member of studio staff. Consent is given separately for each
          studio you interact with. Consent to receive text messages is not a condition of any
          purchase.
        </p>
        <p>
          <strong className="text-mist">Message frequency.</strong> Message frequency varies and
          depends on your booking activity — typically 1 to 5 messages per booking.
        </p>
        <p>
          <strong className="text-mist">Cost.</strong> Message and data rates may apply. Pulse does
          not charge you for these messages; your mobile carrier&rsquo;s standard rates apply.
        </p>
        <p>
          <strong className="text-mist">Opting out.</strong> Reply{" "}
          <strong className="text-mist">STOP</strong> to any message to stop receiving texts. You may
          also send OPTOUT, CANCEL, END, QUIT, UNSUBSCRIBE, REVOKE, or STOPALL. You will receive one
          confirmation message and then no further messages. Reply{" "}
          <strong className="text-mist">START</strong> to opt back in.
        </p>
        <p>
          <strong className="text-mist">Help.</strong> Reply <strong className="text-mist">HELP</strong>{" "}
          or INFO to any message, or email{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-gold hover:underline">
            {LEGAL_EMAIL}
          </a>
          .
        </p>
        <p>
          <strong className="text-mist">Carriers.</strong> Wireless carriers are not liable for
          delayed or undelivered messages. Supported carriers may change without notice.
        </p>
        <p>
          <strong className="text-mist">Privacy.</strong> Mobile information collected for this
          program is handled as described in our{" "}
          <Link href="/privacy" className="text-gold hover:underline">
            Privacy Policy
          </Link>
          . No mobile information will be shared with third parties or affiliates for marketing or
          promotional purposes.
        </p>
      </Section>

      <Section heading="Accounts">
        <p>
          You are responsible for the accuracy of the information you give us, for keeping your
          login credentials secure, and for activity that occurs under your account. Tell us
          promptly if you believe your account has been compromised.
        </p>
      </Section>

      <Section heading="Bookings and payments">
        <p>
          Studios set their own rates, deposit requirements, and cancellation policies. Payments are
          processed by Stripe and settle to the studio&rsquo;s own Stripe account. Disputes about a
          session, deposit, or refund are between you and the studio; we will help where we
          reasonably can.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>You agree not to use Pulse to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Break the law or infringe anyone&rsquo;s rights.</li>
          <li>Send unsolicited, deceptive, or unlawful messages to anyone.</li>
          <li>Upload malicious code, or attempt to breach or disrupt the service.</li>
          <li>Access accounts or data that are not yours.</li>
        </ul>
        <p>
          Studios sending messages through Pulse are responsible for obtaining valid consent from
          every recipient and for complying with the TCPA, CTIA guidelines, and carrier rules.
        </p>
      </Section>

      <Section heading="Subscriptions and cancellation">
        <p>
          Paid plans bill in advance on a recurring basis until cancelled. You may cancel at any
          time and your plan runs to the end of the paid period. Fees already paid are
          non-refundable except where required by law.
        </p>
      </Section>

      <Section heading="Availability and disclaimer">
        <p>
          We work to keep Pulse available and accurate, but the service is provided &ldquo;as
          is&rdquo; without warranties of any kind, express or implied, to the fullest extent
          permitted by law. We do not warrant that the service will be uninterrupted or error free.
        </p>
      </Section>

      <Section heading="Limitation of liability">
        <p>
          To the fullest extent permitted by law, {LEGAL_ENTITY} is not liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits, revenue, or
          data. Our total liability arising out of or relating to the service is limited to the
          amount you paid us in the twelve months before the event giving rise to the claim.
        </p>
      </Section>

      <Section heading="Termination">
        <p>
          You may stop using Pulse at any time. We may suspend or terminate access if these Terms
          are breached, if required by law, or to protect the service and its users.
        </p>
      </Section>

      <Section heading="Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be reflected in the
          &ldquo;last updated&rdquo; date above. Continued use after a change means you accept the
          revised Terms.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These Terms are governed by the laws of the State of California, United States, without
          regard to its conflict of laws rules.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          {LEGAL_ENTITY}, {LEGAL_ADDRESS}. Email{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-gold hover:underline">
            {LEGAL_EMAIL}
          </a>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
