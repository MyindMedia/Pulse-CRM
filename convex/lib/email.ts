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
  const from = args.from ?? process.env.RESEND_FROM ?? "Pulse <support@thamyind.com>";
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
