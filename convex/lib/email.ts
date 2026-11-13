/* Resend transactional email. Returns a status string so callers can
   record it on the invite row. No-ops to "simulated" when unconfigured.

   Branding: client-facing mail (the default) is wrapped in the shared Pulse
   layout (./emailLayout) unless it already carries a Pulse or studio frame.
   Internal mail sets audience: "internal" and goes out plain. `raw: true` is
   for the outreach path only, which has its own approved template. */
import { stripEmDashes } from "./text";
import { ensureBranded } from "./emailLayout";

export type EmailStatus = "sent" | "failed" | "simulated";

/** The From header for mail a studio sends through Pulse:
 *  "<Studio> via Pulse <support@studiopulse.tech>". The studio name is free
 *  text a studio owner types, so before it goes into a header it loses every
 *  character that could close the display name, add an address or start a
 *  new header: quotes, angle brackets, commas, the other RFC 5322 specials
 *  (@ ; : \ ( ) [ ]) and control characters (CR and LF among them). Periods
 *  and apostrophes stay ("St. Louis Sound", "Mike's Place"). */
export function studioSender(studioName: string | null | undefined): string {
  const clean = (studioName ?? "")
    .replace(/[\p{Cc}"<>,@;:\\()[\]]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .trim();
  return `${clean || "Your studio"} via Pulse <support@studiopulse.tech>`;
}

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
  /** Extra mail headers, e.g. List-Unsubscribe on reminder mail. */
  headers?: Record<string, string>;
  /** Where a reply goes. Studio mail to clients sets the studio's own address,
   *  so "Reply to this email" reaches the studio, not Pulse's inbox. */
  replyTo?: string;
}): Promise<EmailStatus> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "simulated";
  const from = args.from ?? process.env.RESEND_FROM ?? "Pulse <support@studiopulse.tech>";
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
        ...(args.headers ? { headers: args.headers } : {}),
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/** The address a studio's clients should reach when they hit Reply: the
 *  studio's contact email, else the owner's. Undefined when neither looks like
 *  an address, so the mail falls back to the sender. */
export function studioReplyTo(
  org: { contact?: { contactEmail?: string }; ownerEmail?: string } | null | undefined,
): string | undefined {
  for (const raw of [org?.contact?.contactEmail, org?.ownerEmail]) {
    const v = raw?.trim();
    if (v && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) return v;
  }
  return undefined;
}
