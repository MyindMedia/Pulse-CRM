"""iPhone launch announcement sent to the Pulse beta studios on 2026-09-21.

Kept as the reference for future product announcements: branded dark email
(betaWelcome style) + a spaced SMS with an MMS image. Send rails: Resend for
email (key in 1Password "Resend Pulse"), GHL conversations/messages with an
attachments URL for the text (scripts/ghl-sms.py has the helpers).

Written to the OWNER or MANAGER reading it: their team clocks in, they see
the money. render_email(first_name) -> (subject, html); sms_text(first_name).
Images are the verified mockup composite, served from the live site.
"""
import html

GOLD = "#fdb913"
GOLD_INK = "#241900"
INK = "#0d0d10"
CARD = "#16161a"
TEXT = "#f2efe9"
FAINT = "#8b857a"
HAIR = "#2a2a30"

APP_STORE = "https://apps.apple.com/app/id6810760056"
MOBILE_PAGE = "https://studiopulse.tech/mobile"
SCENE_IMG = "https://studiopulse.tech/mobile/app-announce.jpg"
PHONE_IMG = "https://studiopulse.tech/mobile/app-announce-phone.jpg"
LOGO = "https://studiopulse.tech/pulse-logo-main.png"

REPLY_TO = "lawrence@myindmedia.org"  # replies to announcements go to the business address, never a personal Gmail
SUBJECT = "The Pulse iPhone app is on the App Store"
FONT = "Inter,Segoe UI,Arial,sans-serif"


def p(text, color=TEXT, size=15, margin="0 0 14px 0"):
    return (
        f'<p style="margin:{margin};font-family:{FONT};font-size:{size}px;'
        f'line-height:1.65;color:{color};">{text}</p>'
    )


def eyebrow(text):
    return (
        f'<p style="margin:0 0 12px 0;font-family:\'Courier New\',monospace;font-size:11px;'
        f'letter-spacing:3px;text-transform:uppercase;color:{GOLD};">{text}</p>'
    )


def render_email(first_name: str | None):
    hello = f"Hi {html.escape(first_name)}," if first_name else "Hi,"
    steps = [
        ("Install it",
         f'On an iPhone, open <a href="{APP_STORE}" style="color:{GOLD};">the App Store link</a> '
         f'or search for <strong style="color:{TEXT};">My Studio Pulse</strong>. It needs iOS 17 or later and it is free.'),
        ("Sign in with the login you already have",
         "The same email you use for Pulse on the web, or Apple or Google if that is how you signed up. "
         "A code arrives by email; enter it and your studio loads."),
        ("Get your team on it",
         "Invite engineers and assistants from Studio on the web. Each of them installs the app and signs in "
         "with the email you invited. Engineers see their sessions and the room; owners and managers see the money as well."),
        ("Allow notifications, and ask your team to",
         "That is how shift alerts, clock reminders and session changes reach everyone while the phone is in a pocket."),
    ]
    steps_html = "".join(
        f'<tr><td valign="top" style="padding:0 14px 14px 0;width:28px;">'
        f'<span style="display:inline-block;width:26px;height:26px;border-radius:13px;background:{GOLD};color:{GOLD_INK};'
        f'font-family:{FONT};font-size:13px;font-weight:700;line-height:26px;text-align:center;">{i}</span></td>'
        f'<td valign="top" style="padding:0 0 14px 0;">'
        f'<p style="margin:0 0 3px 0;font-family:{FONT};font-size:15px;font-weight:700;color:{TEXT};">{title}</p>'
        f'<p style="margin:0;font-family:{FONT};font-size:14px;line-height:1.6;color:{FAINT};">{body}</p></td></tr>'
        for i, (title, body) in enumerate(steps, 1)
    )
    does = [
        ("Today", "your team clocks in and out from their phones with one tap, and you see who is actually in."),
        ("Schedule", "seven days of sessions across every room. Confirm, move, extend or assign an engineer from the session itself."),
        ("Prep", "arrival prep and session checklists, so the room is ready before the client walks in and closed out after they leave."),
        ("Patch", "every connection in every room: what is plugged into what, and how. When an engineer re-patches or moves a cable, they log it from the phone, so you always have the current wiring and a record of every change."),
        ("Receipts and expenses", "snap a receipt with the phone. Pulse reads the vendor, total and date, matches it to the bank transaction and the expense with a score, and you confirm or correct it in a tap. Expenses have categories now."),
        ("Money", "bank balances next to what is due today, invoices and payments, and the profit and loss built from all of it, with the receipts still needing review and the expenses that have none."),
        ("Team", "who is rostered, who is actually clocked in, and who has not turned up yet."),
    ]
    does_html = "".join(
        f'<p style="margin:0 0 8px 0;font-family:{FONT};font-size:14px;line-height:1.6;color:{FAINT};">'
        f'<strong style="color:{TEXT};">{k}.</strong> {v}</p>'
        for k, v in does
    )

    body = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{html.escape(SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:{INK};">
<div style="display:none;max-height:0;overflow:hidden;color:{INK};">Free on the App Store, same logins as the web. Your team clocks in from their phones and tracks the schedule; you see balances, receipts and what each client owes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{INK};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:{CARD};border:1px solid {HAIR};border-radius:14px;overflow:hidden;">

      <tr><td style="padding:26px 28px 0 28px;">
        <img src="{LOGO}" alt="Pulse" width="96" style="display:block;width:96px;height:auto;border:0;"/>
        <p style="margin:12px 0 0 0;font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:{GOLD};">iPhone app &middot; Now on the App Store</p>
      </td></tr>

      <tr><td style="padding:16px 28px 0 28px;">
        <h1 style="margin:0;font-family:{FONT};font-size:26px;line-height:1.2;font-weight:800;color:{TEXT};">Your studio, on your team&rsquo;s phones</h1>
      </td></tr>

      <tr><td style="padding:16px 28px 0 28px;">
        {p(hello)}
        {p("The Pulse iPhone app is live. It is free and it signs in with the accounts you already use on the web. Your team clocks in from their phones, tracks the schedule and preps the room from wherever they are. You see who is on the clock, what each client owes and the money as it moves, without waiting to be back at the desk.", FAINT)}
      </td></tr>

      <tr><td style="padding:6px 28px 0 28px;">
        <a href="{MOBILE_PAGE}" style="text-decoration:none;">
          <img src="{SCENE_IMG}" alt="My Studio Pulse running on an iPhone on a studio desk" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:10px;"/>
        </a>
      </td></tr>

      <tr><td align="center" style="padding:22px 28px 6px 28px;">
        <a href="{APP_STORE}" style="display:inline-block;background:{GOLD};color:{GOLD_INK};font-family:{FONT};font-weight:700;font-size:15px;padding:13px 30px;border-radius:10px;text-decoration:none;">Download on the App Store</a>
        <p style="margin:10px 0 0 0;font-family:{FONT};font-size:12px;color:{FAINT};">Free &middot; iOS 17 or later &middot; iPhone</p>
      </td></tr>

      <tr><td style="padding:24px 28px 0 28px;">
        {eyebrow("What it does")}
        {p("Everything below is on the phone today. The receipts, balances and profit and loss pieces are new this month, on the web as well.", FAINT, 14)}
        {does_html}
      </td></tr>

      <tr><td style="padding:12px 28px 0 28px;">
        {eyebrow("Getting set up")}
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">{steps_html}</table>
      </td></tr>

      <tr><td style="padding:10px 28px 0 28px;">
        {p(f'Nothing is sold in the app. It opens the workspace your studio already has. The full rundown is at <a href="{MOBILE_PAGE}" style="color:{GOLD};">studiopulse.tech/mobile</a>.', FAINT, 14, "0")}
      </td></tr>

      <tr><td style="padding:22px 28px 0 28px;">
        {p("You are one of a handful of studios using this before anyone else. If something is missing or wrong on the phone, reply to this email and tell me. That is the whole reason you are early.")}
        {p("Lawrence", TEXT, 15, "0")}
      </td></tr>

      <tr><td style="padding:22px 28px 24px 28px;">
        <div style="border-top:1px solid {HAIR};padding-top:14px;">
          <p style="margin:0;font-family:{FONT};font-size:11px;line-height:1.6;color:#5f5a52;">If the button does not work, paste this into Safari on an iPhone:<br/>
          <span style="color:{FAINT};word-break:break-all;">{APP_STORE}</span></p>
          <p style="margin:10px 0 0 0;font-family:{FONT};font-size:11px;color:#5f5a52;">Pulse by ThaMyind &middot; studiopulse.tech</p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>"""
    return SUBJECT, body


def sms_text(first_name: str | None = None) -> str:
    hi = f"{first_name}, the" if first_name else "The"
    return (
        f"Pulse: {hi} iPhone app is live. Free, same logins as the web.\n\n"
        "Your team clocks in from their phones and tracks the schedule; you see who is in.\n\n"
        "Wiring changes get logged in the patch bay, so every room's connections stay current.\n\n"
        "Receipts get snapped on the phone for expenses; you see bank balances, matched receipts and the P&L.\n\n"
        "Plus session prep, invoices, payments, the team roster and more.\n\n"
        f"Get it: {APP_STORE}\nDetails: {MOBILE_PAGE}\n\n"
        "Reply STOP to opt out."
    )


if __name__ == "__main__":
    import sys
    subj, h = render_email("OT")
    open(sys.argv[1] if len(sys.argv) > 1 else "ios_launch_sample.html", "w").write(h)
    print(subj)
    print(len(sms_text("OT")), "chars:", sms_text("OT"))
