/* Resend transactional email. Returns a status string so callers can
   record it on the invite row. No-ops to "simulated" when unconfigured.

   Branding: client-facing mail (the default) is wrapped in the shared Pulse
   layout (./emailLayout) unless it already carries a Pulse or studio frame.
   Internal mail sets audience: "internal" and goes out plain. `raw: true` is
   for the outreach path only, which has its own approved template. */
import { stripEmDashes } from "./text";
import { ensureBranded } from "./emailLayout";

export type EmailStatus = "sent" | "failed" | "simulated";
export type EmailAudience = "client" | "internal";

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  /** "client" (default): wrapped in the Pulse layout. "internal": sent as-is. */
  audience?: EmailAudience;
  /** Skip all branding handling. Outreach only (convex/outreachSend.ts). */
  raw?: boolean;
}): Promise<EmailStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "simulated";
  const from = args.from ?? process.env.RESEND_FROM ?? "Pulse <support@thamyind.com>";
  const subject = stripEmDashes(args.subject);
  const cleaned = stripEmDashes(args.html);
  const wrap = !args.raw && (args.audience ?? "client") === "client";
  const html = wrap ? ensureBranded(cleaned, subject) : cleaned;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject,
        html,
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
