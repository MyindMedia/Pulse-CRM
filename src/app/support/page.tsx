import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, Section, LEGAL_EMAIL, LEGAL_PHONE } from "@/components/marketing/legal-shell";

export const metadata: Metadata = {
  title: "Support | Pulse",
  description: "How to get help with Pulse, the studio operating system, on the web and on iPhone.",
  alternates: { canonical: "/support" },
};

/* Static: App Review and the App Store listing link here signed-out. */
export const dynamic = "force-static";

export default function Support() {
  return (
    <LegalShell title="Support" updated="September 10, 2026">
      <Section heading="Get help">
        <p>
          Email{" "}
          <a className="text-gold underline-offset-4 hover:underline" href={`mailto:${LEGAL_EMAIL}`}>
            {LEGAL_EMAIL}
          </a>{" "}
          with the studio name, the account email, and what you were doing. We answer within one
          business day. For anything urgent during a session, call {LEGAL_PHONE}.
        </p>
      </Section>

      <Section heading="Signing in">
        <p>
          Pulse uses the same account on the web and in the iPhone app. Sign in with the email a
          studio invited, with your phone number, with Google, or with Apple on iPhone. A code is
          sent to the address or number on the account; check spam once, then ask us and we will
          resend the invitation.
        </p>
        <p>
          If the app says you are not on any studio&rsquo;s team, the studio owner adds you from
          Studio in the web app, and the invitation email links your login to that seat.
        </p>
      </Section>

      <Section heading="The iPhone app">
        <p>
          Clock in and out, see the day&rsquo;s sessions, the patch bay and the arrival checklists,
          and get alerts for shifts and clock punches. The app works without a connection and sends
          what you did when signal returns. Widgets and the Dynamic Island show who is on the clock
          and what arrives next. Alerts need Notifications allowed for Pulse in Settings.
        </p>
      </Section>

      <Section heading="Your account and your data">
        <p>
          Sign out from More in the app. To delete your account, open More, then Delete account:
          your login is removed and your seat on every studio is closed. The studio keeps its own
          records of shifts and sessions with your name removed, because those are the
          studio&rsquo;s payroll and booking history. A studio&rsquo;s only owner must make another
          owner first, or delete the studio from the web app. You can also email us to delete an
          account or to ask what we hold. See the{" "}
          <Link className="text-gold underline-offset-4 hover:underline" href="/privacy">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link className="text-gold underline-offset-4 hover:underline" href="/terms">
            terms of service
          </Link>
          .
        </p>
      </Section>
    </LegalShell>
  );
}
