# Google Calendar setup (studio and team member calendars)

## Why connecting kept failing (root cause)

The Google OAuth app is in Testing mode. In Testing mode Google (1) lets only listed test users connect, (2) expires every refresh token after 7 days, and (3) never verifies the `convex.site` callback domain. So connects were refused for most people, and the few that worked died a week later, with Pulse retrying a dead token and saying nothing. Publishing the app is a console action, not code. The code now makes every one of these failures visible.

## What the code does now

- The callback redirects back with a specific reason: `access_denied`, `state_mismatch`, `missing_code`, `exchange_failed`, `no_refresh_token`, `server_error`. Settings (and the client email card) show it in plain words.
- A connect with no refresh token is an error, not a silent success.
- A failed push to Google is saved on the studio (`orgs.googleCalendarPushError`, `...At`) and shown in the sync card. A good push clears it.
- `invalid_grant` on refresh clears the token, falls email back to the internal channel, and the card shows "Reconnect Google". Same for a team member's calendar.
- The redirect URI is `GOOGLE_REDIRECT_URI` when set, else `${CONVEX_SITE_URL}/google/callback`. A Next.js route at `/google/callback` forwards the query to the Convex endpoint and returns its redirect, so Google only ever sees `studiopulse.tech`.
- New scope `calendar.calendarlist.readonly` (to list calendars for the picker). Studios already connected must press Reconnect Google once to pick a different calendar; until then they stay on primary and nothing breaks.

## Env values

Convex deployment env (set on each deployment with `npx convex env set`):

| Var | Production | Staging (fiery-cricket-350) |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | existing OAuth client | same client |
| `GOOGLE_REDIRECT_URI` | `https://studiopulse.tech/google/callback` | `https://studiopulse-staging.netlify.app/google/callback` (the old bare URL; it 301s to the branch deploy with the query string, so the Google client needs no change) |
| `APP_URL` | `https://studiopulse.tech` | `https://develop--studiopulse-staging.netlify.app` |

Netlify (site env) already needs `NEXT_PUBLIC_CONVEX_URL`. The forwarder derives the `.convex.site` origin from it; set `NEXT_PUBLIC_CONVEX_SITE_URL` only if the two ever differ.

No `GOOGLE_REDIRECT_URI` set means the old behavior: callback on `${CONVEX_SITE_URL}/google/callback`.

## Google Cloud console steps (Lawrence)

1. Open console.cloud.google.com, pick the Pulse project, then APIs and Services, OAuth consent screen (Google Auth platform, Branding).
2. Authorized domains: add `studiopulse.tech`. Set the app home page, privacy (`https://studiopulse.tech/privacy`) and terms (`https://studiopulse.tech/terms`) links.
3. Clients, open the existing web client, Authorized redirect URIs, add both:
   - `https://studiopulse.tech/google/callback`
   - `https://studiopulse-staging.netlify.app/google/callback`
   Keep the old `https://<deployment>.convex.site/google/callback` entries until the new ones are proven, then remove them.
4. Data access (scopes): confirm these are listed: `gmail.send`, `calendar.events`, `calendar.calendarlist.readonly`, `userinfo.email`, `openid`.
5. Audience: press **Publish app** (Testing to In production). This ends the 7-day token expiry and the test-user list.
6. `gmail.send` and Calendar scopes are sensitive, so Google will show an "unverified app" screen until verification passes. Start verification from the same page (needs the domain, privacy policy link and a short demo video). Until approved, users click Advanced, then Go to Pulse.
7. Set the Convex and Netlify env above, redeploy Convex, then test on staging: Settings, Integrations, Connect Google, and Schedule, My Google calendar.

## Verify on staging

1. Connect the studio calendar; the card shows account, calendar, direction and "Last pull".
2. Pick a shared calendar and direction. Book a session: it appears there (tentative for a pending request).
3. Move that event in Google; within 10 minutes the booking shows "Changed in Google" and a pending change request exists. The booking itself does not change.
4. As an engineer, connect My Google calendar; add a busy event; the staff schedule shows "Busy" with no title.
5. Revoke Pulse at myaccount.google.com/permissions; the next sync shows "Reconnect Google".

## Notes for the orchestrator

- No schema edits were made. A member connect marks `oauthStates.orgId` as `<orgId>::member::<memberId>` instead of new `kind`/`memberId` fields. If you add optional `kind` and `memberId` to `oauthStates`, change `encodeMemberState` / `decodeState` in `convex/googleAuth.ts`.
- `memberCalendars.refreshToken` is cleared to `""` (required string) on `invalid_grant`, with `syncError = "reconnect_required"`. There is no `calendarName` on `memberCalendars`; the picker reads names live.
- The 10-minute `google-calendar-pull` cron now also schedules member pulls (`memberCalendar.scheduleMemberPulls`); no new cron.
- Google edits to a Pulse booking create `sessionChangeRequests` rows (`origin: "google"`, approver = creator or owner). The approve/decline UI belongs to the change-approval agent; `ChangedInGoogleBadge` is ready to mount in the booking sheet.
