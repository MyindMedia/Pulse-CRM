/* Pay-first signup: emailed to the buyer after checkout so they can finish
   creating their login even if they closed the success page.

   Returns the message BODY only. sendEmail wraps it in the shared Pulse layout
   (header, footer, address), so this template has no frame of its own. */

import { escapeEmailHtml } from "./layout";

export function activationEmailSubject(): string {
  return "Finish setting up your Pulse account";
}

export function activationEmailHtml(args: { activationUrl: string }): string {
  const url = escapeEmailHtml(args.activationUrl);
  return `<h1 style="margin:0 0 10px 0;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:22px;line-height:1.3;color:#101015;">Your payment went through</h1>
<p style="margin:0 0 18px 0;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.65;color:#3a3a42;">Finish setting up your studio by creating your login. It only takes a minute.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td align="center" bgcolor="#fdb913" style="background:#fdb913;border-radius:11px;">
<a href="${url}" style="display:inline-block;padding:14px 28px;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:800;color:#1a1405;text-decoration:none;">Create my login</a>
</td></tr></table>
<p style="margin:0;font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.6;color:#6e6e76;">If the button does not work, paste this link into your browser:<br><a href="${url}" style="color:#6e6e76;word-break:break-all;">${url}</a></p>`;
}
