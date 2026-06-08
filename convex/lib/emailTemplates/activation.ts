/* Pay-first signup: emailed to the buyer after checkout so they can finish
   creating their login even if they closed the success page. */

export function activationEmailSubject(): string {
  return "Finish setting up your Pulse account";
}

export function activationEmailHtml(args: { activationUrl: string }): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;background:#08080a;color:#f6f6f5;padding:32px;border-radius:14px;max-width:480px;margin:0 auto">
    <p style="font-family:monospace;letter-spacing:2px;color:#fdb913;font-size:12px;text-transform:uppercase;margin:0">Pulse</p>
    <h1 style="font-size:22px;margin:10px 0 6px;color:#f6f6f5">Your payment went through</h1>
    <p style="color:#a3a3ad;font-size:14px;line-height:1.6;margin:0">Finish setting up your studio by creating your login. It only takes a minute.</p>
    <a href="${args.activationUrl}" style="display:inline-block;margin-top:18px;background:#fdb913;color:#241900;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:9999px;font-size:14px">Create my login</a>
    <p style="color:#6c6c76;font-size:12px;margin-top:22px;line-height:1.6">If the button does not work, paste this link into your browser:<br>${args.activationUrl}</p>
  </div>`;
}
