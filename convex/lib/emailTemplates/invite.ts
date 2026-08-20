/** Escape a value before interpolating it into the email HTML. Inputs
 *  (studio name, owner name, inviter, accept URL) come from semi-trusted
 *  admin input; escaping prevents HTML/layout injection in the inbox. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function inviteEmailSubject(studioName: string): string {
  return `You're invited to ${studioName} on Pulse`;
}

/** Turn a stored role slug into a human label for the inbox. */
export function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function teammateEmailSubject(studioName: string): string {
  return `${studioName} added you to their Pulse team`;
}

/** Staff-framed invite: a teammate is joining an existing studio, not
 *  setting one up. Highlights their role + a short "what's next" (set a
 *  password, add a photo, set your availability). */
export function teammateEmailHtml(args: {
  memberName: string;
  studioName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  logoUrl: string;
}): string {
  const memberName = esc(args.memberName);
  const studioName = esc(args.studioName);
  const inviterName = esc(args.inviterName);
  const role = esc(roleLabel(args.role));
  const acceptUrl = esc(args.acceptUrl);
  const logoUrl = esc(args.logoUrl);
  const initials =
    args.memberName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f1f3;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f3;padding:28px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e7ea">
        <tr><td align="center" style="background:#0d0d10;border-bottom:3px solid #fdb913;padding:32px 40px">
          <img src="${logoUrl}" alt="Pulse" height="34" style="display:block;height:34px">
          <div style="margin-top:14px;display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#fdb913;border:1px solid rgba(253,185,19,.4);border-radius:999px;padding:5px 13px;font-weight:700">Team Invitation</div>
        </td></tr>
        <tr><td style="padding:34px 40px 8px">
          <h1 style="margin:0 0 14px;font-size:22px;color:#101015">You're on the team.</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3a3a42">Hi ${memberName}, <b>${inviterName}</b> added you to <b>${studioName}</b> on Pulse - the studio CRM the team uses to run sessions, schedules and clients.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ea;border-radius:12px;margin:0 0 22px">
            <tr>
              <td width="56" style="padding:16px 0 16px 18px"><div style="width:42px;height:42px;border-radius:10px;background:#101015;color:#fdb913;font-weight:800;font-size:16px;text-align:center;line-height:42px">${initials}</div></td>
              <td style="padding:16px 18px"><b style="font-size:15px;color:#101015">${studioName}</b><br><span style="font-size:13px;color:#8a8a92">Joining as ${role}</span></td>
            </tr>
          </table>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3a3a42">After you set a password it takes about a minute to get set up:</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;font-size:14px;color:#3a3a42">
            <tr><td style="padding:3px 0">&#10003;&nbsp; Add a profile photo so the team knows who you are</td></tr>
            <tr><td style="padding:3px 0">&#10003;&nbsp; Set your weekly availability so you get scheduled right</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 8px">
          <a href="${acceptUrl}" style="display:inline-block;background:#fdb913;color:#1a1405;font-weight:800;font-size:15px;text-decoration:none;padding:15px 28px;border-radius:11px">Join ${studioName} &rarr;</a>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 30px">
          <p style="margin:0;font-size:12px;color:#9a9aa2;line-height:1.6">Button not working? Paste this link:<br><a href="${acceptUrl}" style="color:#6a6a72;word-break:break-all">${acceptUrl}</a></p>
        </td></tr>
        <tr><td align="center" style="background:#f1f1f3;border-top:1px solid #e7e7ea;padding:20px 40px">
          <p style="margin:0;font-size:11.5px;color:#9a9aa2;line-height:1.6">You received this because ${inviterName} added you to ${studioName} on Pulse.<br>This link is unique to you and expires in 7 days.<br>Pulse - Myind Media</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function inviteEmailHtml(args: {
  ownerName: string;
  studioName: string;
  inviterName: string;
  acceptUrl: string;
  logoUrl: string;
}): string {
  const ownerName = esc(args.ownerName);
  const studioName = esc(args.studioName);
  const inviterName = esc(args.inviterName);
  const acceptUrl = esc(args.acceptUrl);
  const logoUrl = esc(args.logoUrl);
  const initials =
    args.studioName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f1f1f3;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a1f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f1f3;padding:28px 0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e7ea">
        <tr><td align="center" style="background:#0d0d10;border-bottom:3px solid #fdb913;padding:32px 40px">
          <img src="${logoUrl}" alt="Pulse" height="34" style="display:block;height:34px">
          <div style="margin-top:14px;display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#fdb913;border:1px solid rgba(253,185,19,.4);border-radius:999px;padding:5px 13px;font-weight:700">Private Beta - Invitation</div>
        </td></tr>
        <tr><td style="padding:34px 40px 8px">
          <h1 style="margin:0 0 14px;font-size:22px;color:#101015">You're in. Welcome to Pulse.</h1>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3a3a42">Hi ${ownerName}, <b>${inviterName}</b> set up a workspace for you on Pulse - the studio operating system. Bookings, deposits, staff and invoices in one place, instead of spread across your phone.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ea;border-radius:12px;margin:0 0 24px">
            <tr>
              <td width="56" style="padding:16px 0 16px 18px"><div style="width:42px;height:42px;border-radius:10px;background:#101015;color:#fdb913;font-weight:800;font-size:16px;text-align:center;line-height:42px">${initials}</div></td>
              <td style="padding:16px 18px"><b style="font-size:15px;color:#101015">${studioName}</b><br><span style="font-size:13px;color:#8a8a92">Studio workspace - invited as Owner</span></td>
            </tr>
          </table>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3a3a42">Click below to claim your account and set a password. This link is unique to you and expires in 7 days.</p>
        </td></tr>
        <tr><td align="center" style="padding:0 40px 8px">
          <a href="${acceptUrl}" style="display:inline-block;background:#fdb913;color:#1a1405;font-weight:800;font-size:15px;text-decoration:none;padding:15px 28px;border-radius:11px">Accept invitation &amp; create account &rarr;</a>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 30px">
          <p style="margin:0;font-size:12px;color:#9a9aa2;line-height:1.6">Button not working? Paste this link:<br><a href="${acceptUrl}" style="color:#6a6a72;word-break:break-all">${acceptUrl}</a></p>
        </td></tr>
        <tr><td align="center" style="background:#f1f1f3;border-top:1px solid #e7e7ea;padding:20px 40px">
          <p style="margin:0;font-size:11.5px;color:#9a9aa2;line-height:1.6">You received this because ${studioName} was added to Pulse.<br>Pulse - Myind Media</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
