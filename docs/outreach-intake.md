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
Instagram does not allow automated cold DMs and sending through a login risks the account, so Pulse never sends. It drafts a short link-free opener from the studio's own bio (or uses the `ig_dm` text from the outreach CSV); you approve each one (24 hour expiry, bound to the exact text), copy it, open `ig.me/m/<handle>`, send it yourself, then mark it sent. One DM per studio per 30 days. "They said stop" is remembered per handle and blocks future DMs.

## What happens next
Confirm the website, click **Find contact info**. Pulse reads the studio's own public pages (robots.txt first, home plus up to two contact/about pages) and lists the published emails, phones, social links and booking platform, each with its source page. Those are published, not verified. A generic inbox (info@, studio@) is not a confirmed decision-maker. **Queue for review** only moves the studio into the review queue.

## Limits you should know
- Instagram's terms prohibit automated collection. This stays low volume and logged out.
- An address a studio published is not checked against a mail server.
- Emails are never sent from these screens. Sending needs an approved template, a verified sender, a postal address in the footer and an opt-out path, each approved by you.

## Email drafts and approval (Review queue tab)
The product is **Pulse OS, the studio operating system** (never "CRM"); the phone companion is the **Pulse app**. No accolade or prize claims anywhere in outreach copy, signatures or alt text: `renderEmail` refuses them (and "CRM", and em dashes), including in an opening line or override.

1. **Queue for review** a scraped prospect, then **Prepare email** on its card.
2. **The first email to every studio comes from Lawrence** (`lawrence_first`, from `Lawrence Berment <lawrenceb@studiopulse.tech>`, Lawrence signature). It opens with a required per-studio **Opening line** (prefilled from the CSV hook), then Lawrence as a producer who has run studios, Pulse OS (bookings, deposits, staff scheduling, gear, invoicing, reporting), the Pulse app (checklists, clock in/out, session notes), the founding offer (50% off the first 3 months) and the 15-minute demo at the booking link (`settings.bookingUrl`, expected `https://studiopulse.tech/demo`, https only). Sign-off: Lawrence Berment, Founder, Pulse OS. An optional **Subject** and **Body** replace only the subject and the middle paragraphs; the greeting, opening line, offer, demo link, footer and opt-out cannot be replaced. Body text is escaped plain text, blank line between paragraphs.
3. **MaxB sends every follow-up and any later message in the thread** (`MaxB | Pulse <info@studiopulse.tech>`, Roverto signature). When Lawrence's email is accepted by Resend, a follow-up sequence starts. An hourly cron (`outreach-sequences`) puts MaxB's day 3, day 7 and day 14 follow-ups (`maxb_followup_1..3`) into the Review queue when they are due. **It only creates drafts**: each still needs **Approve this email** and a person's **Send now**. MaxB can also reply by hand (`maxb_reply`, From: MaxB in the Prepare block once Lawrence has emailed).
4. **Threading:** every send sets `Message-ID: <pulse-outreach-<draftId>@studiopulse.tech>` (stored on the communication and the sequence, with Resend's id). Follow-ups and replies use `Re: <Lawrence's subject>` and set `In-Reply-To` and `References` to that Message-ID. **Reply-To is both inboxes** (`lawrenceb@` and `info@`), so a studio's answer reaches Lawrence and MaxB. Check in an owner test that Gmail threads MaxB's follow-up under Lawrence's email (if Resend replaced the Message-ID, the shared `Re:` subject still threads in Gmail).
5. **The sequence stops** (and cancels a waiting follow-up draft) when the studio replied (detected in stored inbound mail, or **Mark replied** on the card), booked a demo (Zuops booking matched by email), an email bounced or drew a complaint, the address opted out or is suppressed, or a person clicks **Stop follow-ups** or cancels a follow-up draft. A stopped sequence never restarts. A replied studio shows the **replied** status; MaxB can still reply in the thread.
6. **Reply detection is read-only.** It does not touch the production receiver (`convex/mailInbound.ts`). The cron reads the inbound mail that receiver already stores (`mailThreads`/`mailMessages`) and counts a reply when, after Lawrence's email, a message arrived from the recipient or threads under his Message-ID.
7. **Signatures:** the default is an exact picture of the Final signature design, badge-free. `scripts/outreach/render_signatures.py` (JPEGs in `signatureImages.ts`) and `render_signature_gif.py` (`public/email/*.gif`) render it from the `ORIGINAL_*` HTML in `signatures.ts`; pass `--browser <chrome>` if Playwright's own browser is missing. The HTML itself and an email-safe rebuild are selectable per draft.
8. **Generic inboxes** (info@, studio@) are held until routing is confirmed: tick the per-draft box, or select studios on the Prospects tab and **Confirm routing for selected** (owner/admin). That records who and when in the activity log and clears the generic-inbox hold on their drafts. It never approves anything.
9. **Approve** needs: a postal address set, an owner test confirmed, an address that has not opted out, and an unchanged draft. Approval is tied to the exact content (including the opening line, subject, body, follow-up override and threading headers) and expires in 24 hours. **Edit copy** in the Review queue, or a CSV import that changes the copy, voids an earlier approval. Approving does not send.
10. Lawrence's address must be a verified sender (operator step, below) before his email can be sent.

## Outreach CSV import (Prospects tab)
**Import outreach CSV** (owner/admin) reads `outreach-staged.csv`, up to 200 rows. Rows match prospects already on the list **by website** (host, lowercased, without `www.`); it never creates a prospect and reports matched, not-on-the-list and skipped rows. Columns used: `website, personalization_hook, hook_source_url, email_subject, email_body, ig_dm, followup_day3, followup_day7, followup_day14, fit_score, priority` (others ignored).
- The hook, subject and body become the defaults for Lawrence's email (prefilled in the Prepare block).
- `followup_day3/7/14` become this studio's copy for MaxB's steps 1 to 3 (the middle paragraph only).
- `ig_dm` becomes the DMs tab draft.
- `email_generic` is never stored: an email address from a spreadsheet is never imported as a contact.
- A blank cell keeps the current value. Changed copy voids the open draft that used the old copy.

Operator steps (not available from the browser), run against the verified deployment:
```
npx convex run outreach:upsertSender '{"agencyId":"<org id>","label":"Lawrence","address":"lawrenceb@studiopulse.tech","verified":true,"operator":"lawrence"}'
npx convex run outreach:setPostalAddress '{"agencyId":"<org id>","address":"<full business address>","operator":"lawrence"}'
npx convex run outreach:confirmOwnerTest '{"agencyId":"<org id>","operator":"lawrence","note":"Landed in Gmail, signature and link checked"}'
```
