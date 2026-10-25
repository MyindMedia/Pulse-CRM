# `ci/*.yml` — install this as a GitHub Action (one command)

```bash
mkdir -p .github/workflows && git mv ci/funnel-liveness.yml .github/workflows/
git commit -m "Arm the funnel-liveness monitor" && git push
```

It must live on the **default branch** (`main`) for `schedule:` to fire. GitHub
ignores `cron` triggers on any other branch.

Two monitors, and the split matters: route uptime answers *does the site
answer*, `funnel-liveness.yml` answers *does the booking-funnel counter still
write*. The second is not implied by the first — a page can serve a perfect 200
and record nothing, which is exactly the failure that would go unseen.

**Route uptime is no longer here.** It is armed and running as a Cloudflare
Worker on a cron trigger: `workers/uptime-watch/` (see its README). `ci/uptime.yml`
was deleted when that went live — it had sat parked and unarmed, which is a
monitor that reads as done and watches nothing.

## Why this one is parked here instead of already installed

The token this repo's automation pushes with holds `repo` scope only. GitHub
refuses any push that creates or edits a file under `.github/workflows/` without
`workflow` scope:

```
! [remote rejected] (refusing to allow a Personal Access Token to create or
  update workflow `.github/workflows/funnel-liveness.yml` without `workflow` scope)
```

So either run the two commands above yourself, or add `workflow` scope to the
PAT and the push goes through unattended next time. Unlike the uptime check,
this one genuinely wants a GitHub runner: it drives Chromium, and Playwright
does not run in a Cloudflare Worker.

## `funnel-liveness.yml` — is the booking-funnel counter still writing?

`scripts/funnel-liveness.mjs` drives Chromium at Myind Sound's own booking page
and asserts that a `bookingVisits` row gets written. Four times a day, not every
ten minutes: it writes a real row each run.

On 2026-10-04 `bookingVisits` had 11 rows lifetime and the newest was 41 days
old, and nothing in the product could say whether that was an empty funnel or a
dead counter (MYI-226). It was the former — a browser load wrote a row — but
answering it took an hour of hand work, because `src/lib/use-booking-funnel.ts`
swallows every failure by design. That is the right call on a booking page: a
dropped measurement must never cost a booking. It is also the shape that turns a
broken write into a confident zero, and `BookingFunnelCard` renders that zero
**to the studio**. The rule this cost us: *a best-effort write with a swallowed
error needs an independent way to prove it is still writing.* This is that way.

Three design points:

1. **It needs no credentials.** The write happens in a `useEffect` after
   hydration over the Convex websocket, so `curl` proves nothing. The script
   reads the websocket and matches the `bookingFunnel:track` frame to its
   response by `requestId`, requiring **both** `success: true` and
   `result.ok: true`. Those are different facts: `success` only means the
   function did not throw, and `track` returns `ok: false` without inserting
   when the slug resolves to no org, the visitorKey is too short, or the
   5,000/day guard trips. Checking only `success` is how this check would have
   gone permanently green on a dead counter. Credential-free is what lets it run
   on a GitHub runner — the only place independent of both Netlify and Convex.
2. **It probes our page, never a customer's.** Each run writes a real row, and a
   row in a client's funnel is a lie to that client. The URL carries
   `?utm_source=uptime-probe`, and the funnel groups by `utmSource`, so the
   probe's visits sit in their own named bucket instead of posing as traffic.
3. **Exit 2 is not an alarm.** `0` wrote a row, `1` means the page served and
   the counter did not record — the real alert. `2` means the page never served,
   which the uptime Worker already pages for; one fault should not page twice.

## Running them by hand

```bash
bash scripts/uptime-check.sh         # exit 0 = all routes 200, 1 = something is down
node scripts/funnel-liveness.mjs     # exit 0 = a row was written, 1 = counter dead, 2 = site down
```

`scripts/uptime-check.sh` is the same check as the Cloudflare Worker, kept for
running it from a terminal during an incident. The Worker in
`workers/uptime-watch/` is the armed, scheduled one — if you change the route
list, change it in both.

`funnel-liveness.mjs` needs Playwright, which is deliberately **not** a
dependency of this repo — it is an ops script and a browser has no business in
the app's lockfile:

```bash
npm i -g playwright && playwright install chromium
```
