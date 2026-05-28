# Pulse Deploy Handoff (2026-05-27 build)

Everything in this commit is built + tested but **not yet deployed**. The dev
environment can't reach cloud Convex (`pastel-corgi-340`) or your third-party
accounts, so the deploy + go-live config are yours to run. Pasting the commands
below in order gets you live.

Pair this with `GO-LIVE.md`, which covers the env-var values per integration.

---

## 1. From the `pulse/` directory

```bash
# Sanity check locally (these should all pass; they did on 2026-05-27)
npx tsc --noEmit
npx vitest run
npm run build
```

## 2. Deploy the Convex backend to the cloud deployment

The new tables and functions need to be pushed before the Netlify build picks
up the frontend, or the live site will hit "unknown function" errors during the
window in between.

```bash
# Option A - you already have a deploy key in 1Password or env:
export CONVEX_DEPLOY_KEY="..."
npx convex deploy

# Option B - interactive login (one time):
npx convex login
npx convex deploy
```

This pushes the new modules (`waitlist.ts`, `predictions.ts`, `rightsExport.ts`,
`portal.ts`) and the schema additions (`waitlistEntries` table, `waitlist_fill`
action type) to `pastel-corgi-340`.

## 3. Set env vars on cloud Convex (only the ones not already set)

See `GO-LIVE.md` for full per-integration steps. The minimum for the new code
to be useful end-to-end:

```bash
# Optional but recommended for richer agent/concierge output:
npx convex env set OPENAI_API_KEY sk-... --prod

# Required to actually send AI-approved emails (already configured per Grilled.md):
# RESEND_API_KEY, RESEND_FROM - verify the domain in Resend first.

# Required to actually charge Stripe deposits (already configured per Grilled.md):
# STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET - enable Connect + register webhook.
```

## 4. Deploy the frontend (Netlify)

Push to the branch Netlify is watching. The build runs there.

```bash
git add -A
git commit -m "Ship waitlist, predictive intelligence, rights export, client portal"
git push  # to the Netlify-connected branch
```

The Netlify build will pick up the new routes (`/portal/[token]`) and updated
pages (`/bookings` waitlist panel, `/reports` pricing & risk tab, song splits
rights-export dialog).

## 5. Post-deploy smoke checks

After the Netlify build succeeds:

1. `/bookings` - confirm the **Waitlist** panel renders in the side column.
   Add a test artist; you should see them listed.
2. `/reports` - open the **Pricing & risk** tab. Both sections should render
   (they will be empty for orgs with no sessions/rooms yet - that is correct).
3. A song with a split sheet - open the **Splits** tab and click **Rights export**.
   The dialog should show the release-ready check and offer JSON/CSV downloads.
4. Open the **Approval Inbox** and cancel a future session via the booking sheet
   (with someone on the waitlist). A `Waitlist Fill` card should appear in a
   `Waitlist` group at the top of the inbox.
5. **Client concierge:** issue a magic-link `artist_portal` grant for a test
   artist (via the existing `grants.issue` flow), then visit
   `https://<your-site>/portal/<token>`. You should see their songs, sessions,
   invoices, and be able to ask the concierge.
6. **Booking sheet risk badge:** open an upcoming session on `/bookings` where
   the artist has poor history or no deposit. You should see the no-show risk
   badge with a suggested deposit %.

## 6. Rollback plan

The backend changes are additive (new tables, new functions, additive fields on
no existing tables). The frontend changes add components and one new tab/panel.
If something looks wrong:

```bash
# Roll the frontend back by reverting the last commit on the watched branch:
git revert HEAD && git push

# The Convex side is safe to leave - the new tables and functions sit unused
# until the frontend calls them again.
```
