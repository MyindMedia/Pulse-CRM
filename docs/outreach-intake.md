# Outreach intake: getting Instagram accounts into the prospect list

Three ways in, all landing in Agency > Outreach > Prospects as "needs website" or "ready to scrape". Nothing here sends email.

## 1. Paste in the tab
Agency > Outreach > Prospects. One handle, Instagram link or website per line.

## 2. iPhone Share Sheet shortcut (the "saved folder" replacement)
Instagram has no supported way to watch a personal Saved folder, and automating your login risks the account. Sharing a profile or post to a Shortcut is the supported equivalent: one tap, no login automation.

Operator setup, once, on the Convex deployment (the deployment is not yet verified, so confirm it first):
```
npx convex env set OUTREACH_INTAKE_SECRET <long random value>
npx convex env set OUTREACH_INTAKE_AGENCY_ID <the agency's Clerk org id>
```
The endpoint is off until both are set. The agency always comes from `OUTREACH_INTAKE_AGENCY_ID`; a caller cannot choose it.

Build the Shortcut (Shortcuts app):
1. New Shortcut, name it "Add to Pulse Outreach". Turn on **Show in Share Sheet**, accept **URLs**.
2. Action **Get Contents of URL**: URL `https://<deployment>.convex.site/outreach/intake`, Method **POST**, Request Body **JSON**, field `url` = Shortcut Input. Header `Authorization` = `Bearer <the secret>`.
3. Action **Show Notification** with the result.
4. In Instagram, Share a profile or post, then pick the Shortcut.

A profile link becomes a handle. A post link is stored with a note asking you to confirm which account owns it. Keep the secret out of screenshots and chat.

## 3. Instaloader helper on your Mac (resolve handle to website)
Logged out only, public profiles, 25 handles per run, 8 to 15 seconds apart, and it stops at the first block.
```
pip install instaloader
export OUTREACH_INTAKE_SECRET=...            # same value as above
python3 scripts/outreach/ig_resolve.py --dry-run icecreamsound
python3 scripts/outreach/ig_resolve.py --intake-url https://<deployment>.convex.site/outreach/intake icecreamsound mixrecordingstudio
```
It reads only the profile's name and link in bio. A link-in-bio page (linktr.ee and similar) is flagged and not trusted; you confirm the real website in the tab.

## 4. Discover tab (treg, paid per call)
Agency > Outreach > Discover. Needs `TREG_TOKEN` in Convex env (the token is never sent to the browser).
- **Google Maps** (`anyapi.maps.contacts`, about $0.001 per studio): a city plus a search such as "recording studio". Returns the studio's website and the emails and phones it publishes. Social links found on those sites are dropped because they are often client accounts.
- **Instagram search** (`treg.instagram.search.users`, about $0.002 per search): public studio-like accounts with bio and website. A link-in-bio page is flagged, never trusted as the website.
- **Find Instagram email** (`anyapi.instagram.profile_contact`, about $0.002): the email or phone the account itself publishes. Shown with the profile as its source.
- Caps per agency per day: 20 searches, 100 profile lookups. Owners and admins only. Everything is "published, not verified".

## 5. DMs tab (draft, approve, you send)
Instagram does not allow automated cold DMs and sending through a login risks the account, so Pulse never sends. It drafts a short link-free opener from the studio's own bio; you approve each one (24 hour expiry, bound to the exact text), copy it, open `ig.me/m/<handle>`, send it yourself, then mark it sent. One DM per studio per 30 days. "They said stop" is remembered per handle and blocks future DMs.

## What happens next
Confirm the website, click **Find contact info**. Pulse reads the studio's own public pages (robots.txt first, home plus up to two contact/about pages) and lists the published emails, phones, social links and booking platform, each with its source page. Those are published, not verified. A generic inbox (info@, studio@) is not a confirmed decision-maker. **Queue for review** only moves the studio into the review queue.

## Limits you should know
- Instagram's terms prohibit automated collection. This stays low volume and logged out.
- An address a studio published is not checked against a mail server.
- Emails are never sent from these screens. Sending needs an approved template, a verified sender, a postal address in the footer and an opt-out path, each approved by you.

## Email drafts and approval (Review queue tab)
1. **Queue for review** a scraped prospect, then **Prepare email** on its card: choose the address, sender and signature.
2. The email is the MaxB template from `pulse-outreach 2/EMAILS.md` (Version B) with one edit, the founder line reads "a Grammy-nominated producer" with no credits or artist names: subject "Your studio has a sound. Now give it a system.", branded dark card, one gold button, your signature, then a footer with the postal address and an opt-out line.
3. **Senders and signatures:** MaxB sends as `MaxB | Pulse <info@studiopulse.tech>` with the Roverto signature (`final pulse_signature_roverto_email.html`). Lawrence is set up as `Lawrence Berment <lawrenceb@studiopulse.tech>` with the Lawrence signature (`Final pulse_signature_email_grammy.html`), but has no approved template yet, so only MaxB drafts can be prepared.
4. **Signatures:** the default is an exact picture of Lawrence's Final signature design (`scripts/outreach/render_signatures.py` renders it from his HTML files; it is sent as an inline attachment). The HTML files themselves are embedded byte for byte and selectable per draft, but Gmail on iPhone strips their CSS and the card falls apart, so they are not the default. An email-safe rebuild is the third option.
5. A generic inbox (info@, studio@) is held until you confirm who handles studio operations.
6. **Approve** needs: a postal address set, an owner test confirmed, an address that has not opted out, and an unchanged draft. Approval is tied to the exact content and expires in 24 hours. It does not send.

Operator steps (not available from the browser), run against the verified deployment:
```
npx convex run outreach:setPostalAddress '{"agencyId":"<org id>","address":"<full business address>","operator":"lawrence"}'
npx convex run outreach:confirmOwnerTest '{"agencyId":"<org id>","operator":"lawrence","note":"Landed in Gmail, signature and link checked"}'
```
