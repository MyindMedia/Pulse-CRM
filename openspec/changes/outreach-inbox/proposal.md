## Why

Owner request, 2026-10-13: "make the out reach interface a bit more compact with a list view of the contacts and allow me to open up a conversation window to see the communication history. It needs to look similar to an email in/out box with a reading pane and a message preview with contact name info that opens up."

Today the Outreach > Prospects tab renders every studio as a large card holding its contacts, the full Prepare email form, the sequence line, badges and every action button. With more than a handful of studios the page becomes a long scroll, and nothing shows the communication history with a studio in one place: sent emails sit in Communications, replies sit in the Email tab, DMs in DMs, demos in Meetings.

## What Changes

- The Prospects tab becomes an inbox. The tab keeps its name: it still lists every studio, including ones not yet contacted, so "Prospects" stays accurate; only the layout changes.
  - **Left: a compact contact list.** One row per studio (about 60px): initials, studio name (bold when an unread reply is waiting), time of the latest activity, a one-line preview of the latest message, and a status chip. A search box and filter chips (All, Needs action, Replied, Booked, Opted out) sit above it.
  - **Right: a reading pane.** A header with the studio's name and key facts (handle, website, primary email, status, reply label, booked demo) and a "Contact info" toggle that opens the full contacts block: emails with generic and opted-out badges and "mark opted out", phones, socials, booking platform, read date, and routing confirmation.
  - **The conversation**, Gmail style: everything Pulse knows about the studio in time order. Older items fold to one line (sender, preview, time); the latest is open; click to open or fold. Sent and received messages are told apart by alignment edge, an icon and a word, never by colour alone.
  - **Every existing per-studio action moves into the pane**: Find contact info / Read again, Confirm website, Queue for review, the full Prepare email form (as a Compose panel under the conversation), Mark replied, Stop follow-ups, Remove, Confirm routing. Bulk "Confirm routing for selected" stays, behind a Select toggle on the list. "Add studios" and "Import outreach CSV" become toolbar buttons that open dialogs.
  - **Phone (390px)**: the list only; tapping a studio opens its conversation full width with a Back button, the same pattern as the Email tab.
- Two new Convex queries in `convex/outreachInbox.ts`, scoped exactly like `outreachProspects.list` (agency membership from the signed-in viewer; agencyId is never a client argument):
  - `list`: one compact row per prospect, sorted by latest activity.
  - `conversation({ prospectId })`: the contact card plus a merged, time-ordered timeline of outbound emails (sent drafts with their delivery status), drafts still waiting in the Review queue, replies and Email-tab messages from the matching mail threads, approved and sent DMs, Zuops demo bookings, confirmation calls, and key status changes.
- Replies are matched with the existing reply rule in `convex/outreach/sequence.ts` (`threadMatchesSequence`, `answersSequence`), extended to every address the studio published. No second matcher.
- Mail content (reply bodies, previews and unread state) is shown only to viewers who can read the Email tab (owner or admin of the mail-owning agency), so the inbox never widens access to received mail. Opening a conversation with an unread reply marks that mail thread read through the existing `mail.markThreadRead`.

## Non-goals

- Sending from the inbox. Nothing here sends: the Compose panel prepares a draft for the Review queue, and every email still needs Approve this email and Send now there. Replying to received mail stays in the Email tab.
- Changing the reply detection rule, the sequence cron, or the Review queue.
- Server-side search or pagination beyond the existing 300-prospect cap.

## Impact

- Convex: new `convex/outreachInbox.ts` (queries only) and `convex/outreach/inbox.ts` (pure helpers); tests next to both. No schema change, no new index.
- Web: `src/components/agency/outreach-inbox.tsx` (new), `outreach-panels.tsx` loses the old `Prospects` card list, `src/app/agency/outreach/page.tsx` mounts the inbox, `thread-view.tsx` exports its sandboxed email frame so both views render received HTML the same way.
