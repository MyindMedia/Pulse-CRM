import { action } from "./_generated/server";
import { v } from "convex/values";
import { sendEmail } from "./lib/email";

/* Public "Contact us" submission from the marketing site. Emails the team via
   Resend; no auth, no table - kept intentionally simple. Degrades to
   "simulated" (still ok) when Resend isn't configured. */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const submit = action({
  args: {
    name: v.string(),
    email: v.string(),
    studio: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (_ctx, args): Promise<{ ok: boolean }> => {
    const name = args.name.trim();
    const email = args.email.trim();
    const message = args.message.trim();
    const studio = args.studio?.trim();
    if (name.length < 2) throw new Error("Please enter your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Please enter a valid email.");
    if (message.length < 5) throw new Error("Please add a short message.");

    const to = process.env.CONTACT_EMAIL ?? "support@myindsound.com";
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.7;color:#111">
      <p style="font-size:16px"><b>New Pulse contact request</b></p>
      <p><b>Name:</b> ${esc(name)}</p>
      <p><b>Email:</b> <a href="mailto:${esc(email)}">${esc(email)}</a></p>
      ${studio ? `<p><b>Studio:</b> ${esc(studio)}</p>` : ""}
      <p><b>Message:</b></p>
      <p style="white-space:pre-wrap;border-left:3px solid #b8860b;padding-left:12px;color:#333">${esc(message)}</p>
    </div>`;
    const status = await sendEmail({
      to,
      subject: `Pulse contact: ${name}${studio ? ` (${studio})` : ""}`,
      html,
    });
    // "simulated" (Resend not configured) is still a success from the caller's
    // perspective - the form shouldn't show an error in unconfigured envs.
    return { ok: status !== "failed" };
  },
});
