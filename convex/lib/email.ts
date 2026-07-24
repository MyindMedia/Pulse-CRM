/* Resend transactional email. Returns a status string so callers can
   record it on the invite row. No-ops to "simulated" when unconfigured. */
import { stripEmDashes } from "./text";

export type EmailStatus = "sent" | "failed" | "simulated";

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<EmailStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "simulated";
  const from = args.from ?? process.env.RESEND_FROM ?? "Pulse <support@myindsound.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: stripEmDashes(args.subject),
        html: stripEmDashes(args.html),
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** Add a contact to the managed Resend Audience so the newsletter broadcast
    path (MYI-52) reaches waitlist subscribers. Best-effort: no-ops to
    "simulated" when RESEND_API_KEY / RESEND_AUDIENCE_ID are unset, and never
    throws (the signup itself must not fail if the audience push does). */
export async function addAudienceContact(
  email: string,
): Promise<"added" | "simulated" | "failed"> {
  const key = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!key || !audienceId) return "simulated";
  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    return res.ok ? "added" : "failed";
  } catch {
    return "failed";
  }
}
