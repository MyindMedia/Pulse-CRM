## 1. Server

- [x] 1.1 `convex/outreach/inbox.ts`: display name, addresses, thread ownership (reusing `threadMatchesSequence` / `answersSequence`), latest activity, needs-action, timeline merge; verify: unit tests.
- [x] 1.2 `convex/outreachInbox.ts` `list`: compact rows, bounded reads (indexes + `.take`), sorted by latest activity; verify: convex-test (scope, other agency, ordering, unread, mail hidden from staff).
- [x] 1.3 `conversation({ prospectId })`: contact card + merged timeline (sent drafts + delivery status, open drafts, matched mail both directions, DMs, bookings, calls, status events); verify: convex-test (ordering, reply matching incl. a reply from a different address threaded under our Message-ID, another studio's reply on the same subject excluded, another agency refused).
- [x] 1.4 Mark read on open through the existing `mail.markThreadRead` (mail access only); verify: convex-test, and in a browser the unread flag clears after opening.

## 2. Web

- [x] 2.1 Inbox layout on the Prospects tab: list (search, filter chips, rows), reading pane, phone list/pane switch with Back.
- [x] 2.2 Reading pane: header, Contact info panel, Gmail-style conversation, Compose panel (the full Prepare email form), every per-studio action.
- [x] 2.3 Add studios and Import outreach CSV dialogs; Select mode with Confirm routing for selected.
- [x] 2.4 Motion 150 to 200ms ease-out, none under reduced motion.
- [x] 2.5 `outreach-panels.test.tsx` moved to the new components; new tests for the list and the pane.

## 3. Checks

- [x] 3.1 `npx tsc --noEmit`, `npm run lint`, `npx vitest run`.
- [x] 3.2 Local run (local Convex backend, signed-in local agency owner), screenshots at 1440 and 390, no horizontal overflow at 390, 834, 1024, 1440 in Chromium, Firefox and WebKit, reduced motion included.
