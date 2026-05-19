# Pulse

The song-centric operating system for music businesses — recording studios, producers and labels. Sessions, splits, revisions, releases and licensing on one unbroken chain from inquiry to royalty.

Built by Myind Sound. Next.js 16 (App Router) · Convex · Clerk · Tailwind v4 · TypeScript.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript (strict) |
| Styling | Tailwind v4 — "Brutalist Studio" dark design system (`src/app/globals.css`) |
| Backend / DB | Convex (real-time queries + mutations) |
| Auth | Clerk — optional. No key configured → **demo mode** (seeded `pulse-demo` workspace, no login) |
| Charts | Recharts · Motion (`motion/react`) · dnd-kit (kanban) · cmdk (command palette) |

## First run

Convex codegen and a dev deployment are required before the app will type-check or boot. This is a one-time interactive step.

```bash
npm install

# 1. Provision a Convex dev deployment + generate convex/_generated/.
#    This is interactive (browser login) and writes NEXT_PUBLIC_CONVEX_URL
#    into .env.local automatically. Leave it running.
npx convex dev

# 2. In a second terminal, start Next.js.
npm run dev
```

Open http://localhost:3000 — it redirects to `/dashboard`.

### Seed the demo studio

On first load the dashboard shows a **"Load demo data"** card. Click it (or run
`npx convex run seed:run`) to populate the `pulse-demo` workspace with Lumen
Recording Co. — a full studio of artists, songs, sessions, invoices, deals,
sync pitches, beat licenses and release campaigns. Every screen is then
explorable with zero further setup.

## Auth modes

- **Demo mode** (no `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) — middleware passes
  through, every request maps to the seeded `pulse-demo` org. Best for local dev
  and walkthroughs.
- **Clerk mode** — set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`,
  and `CLERK_JWT_ISSUER_DOMAIN` on the Convex dashboard. Multi-tenant: the active
  Clerk org id scopes every Convex record. See `convex/auth.config.ts`.

## Layout

```
convex/            Schema + all queries/mutations (org-scoped, money in cents)
  schema.ts        16 tables — songs is the spine
  seed.ts          Demo workspace builder (seed:run)
src/
  app/(app)/       Authenticated routes — dashboard, songs, roster, pipeline,
                   calendar, payments, releases, licensing, studio, settings
  components/ui/   Shared primitives (Button, Card, Sheet, Table, ...)
  components/shell/ Sidebar, topbar, command palette (Cmd+K), insights bell
  lib/             format, labels, nav, motion helpers
```

## Scripts

```bash
npm run dev      # Next.js dev server (run alongside `npx convex dev`)
npm run build    # Production build
npm run lint     # ESLint
```
