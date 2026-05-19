# Enabling real Clerk auth

Pulse already has the Clerk SDK installed (`@clerk/nextjs`), the middleware,
the conditional `<ClerkProvider>`, and `/sign-in` + `/sign-up` pages. It runs in
**demo mode** until you add Clerk keys. There is **no `npm install` to run** —
do not run `npm create next-app`; that scaffolds a separate throwaway project.

To switch Pulse from demo mode to real studio logins:

## 1. Create a Clerk application

1. Go to https://dashboard.clerk.com and create an application.
2. **Configure → Organizations → Enable Organizations.** (Required — each studio
   subaccount is a Clerk Organization.)

## 2. Create the "convex" JWT template

In the Clerk dashboard: **Configure → JWT Templates → New template → Convex.**
Save it. Copy the **Issuer** URL it shows (looks like
`https://your-app-12.clerk.accounts.dev`). Convex needs this — `convex/auth.config.ts`
already trusts the `"convex"` template.

## 3. Add keys to `pulse/.env.local`

From **Configure → API Keys**, add these two lines to `pulse/.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxx
```

## 4. Set Convex deployment env vars

Convex functions (the JWT check + the subaccount-provisioning action) read their
own env. Run these from `pulse/`:

```
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://your-app-12.clerk.accounts.dev
npx convex env set CLERK_SECRET_KEY sk_test_xxxxxxxx
```

- `CLERK_JWT_ISSUER_DOMAIN` — the Issuer from step 2 (replaces the placeholder
  `https://demo.pulse.invalid`).
- `CLERK_SECRET_KEY` — lets `agency.createSubaccount` create real Clerk
  Organizations and email owner invites.

## 5. (Optional) Lock the agency console

```
npx convex env set AGENCY_ADMIN_EMAILS you@myindmedia.org
```

Comma-separated. When set, only those emails can open `/agency`. Unset → open.

## 6. Restart

Restart `npm run dev` (and `npx convex dev`) so the new env is picked up. Pulse
now requires sign-in; the middleware gates every route except `/`, `/sign-in`,
`/sign-up`, `/book/*` and webhooks. Creating a subaccount in `/agency` now
provisions a real Clerk Organization and emails the studio owner an invite.

## Notes

- With keys absent Pulse stays in demo mode — `/sign-in` shows a "demo mode"
  notice and the agency console provisions demo workspaces instead.
- The studio owner accepts the emailed invite, lands on `/sign-up`, sets a
  password, and is dropped into their studio workspace.
