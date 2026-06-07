# Pulse Marketing Landing Page

**Date:** 2026-06-07
**Status:** Built + shipped

## Goal
A full, modern SaaS marketing site served at the root URL (`/`) for logged-out
visitors, with login/sign-up in the top-right. Sleek, on-brand, self-serve.

## Decisions (from grilling)
- **Visual direction:** Cohesive dark glass. Reuses the app's exact tokens
  (coal/ink background, gold `#FDB913` accent, bone text, glass `material-*`
  surfaces, Space Grotesk display + Inter body). The site reads as a seamless
  extension of the product, not a separate brand.
- **Primary CTA:** Self-serve sign up. Every CTA routes to Clerk `/sign-up`;
  "Log in" routes to `/sign-in`.
- **Signed-in behavior at `/`:** Auto-redirect to `/dashboard`. Marketing is
  only for logged-out visitors (and demo mode, where Clerk is unconfigured).
- **Pricing:** Show three tiers (Solo / Studio / Label) with placeholder,
  clearly-editable prices. No platform fee on client payments (matches the
  Connect model: studios keep 100%).

## Architecture
- **Routing:** `src/app/page.tsx` becomes an async Server Component. When Clerk
  is enabled it calls `auth()`; a signed-in `userId` triggers
  `redirect("/dashboard")`. Otherwise it renders `<LandingPage />`. `/` is
  already a public route in `middleware.ts`, so no gating changes were needed.
- **Components:** `src/components/marketing/`, one focused file per section:
  - `landing-nav.tsx` (client) - sticky header; transparent over the hero,
    frosts to glass on scroll; logo + anchors + Log in / Get started.
  - `hero.tsx` - headline, subhead, dual CTA, and a CSS-built faux glass
    dashboard preview (no raster dependency; swappable for a real screenshot).
  - `chain.tsx` - the signature differentiator: Inquiry -> Booking -> Session
    -> Splits -> Release -> Royalty.
  - `features.tsx` - six module cards (catalog, sessions, splits/licensing,
    bookings/deposits, payments, AI Agent).
  - `pricing.tsx` - Solo / Studio (featured) / Label, placeholder prices.
  - `cta.tsx` - closing call to action.
  - `footer.tsx` - brand, links, copyright.
  - `landing-page.tsx` - composes the stack.
  - `reveal.tsx` (client) - dependency-free scroll-reveal (IntersectionObserver),
    respects `prefers-reduced-motion`. Supports an `immediate` mode that reveals
    on mount, used for all above-the-fold hero content so the primary CTA is
    never gated behind a scroll trigger.

## Constraints
- No `framer-motion` (not a dependency) - animation is pure CSS + the `Reveal`
  IntersectionObserver wrapper.
- No em dashes anywhere in copy (global rule).
- Above-the-fold content must render on load, not on scroll.

## Non-goals (YAGNI)
- Blog, real customer-logo wall, testimonials (none real yet), i18n.

## Verification
- `tsc --noEmit`, ESLint, `next build` all green.
- Visual check via agent-browser at `/`: hero CTA + dashboard preview render on
  load; all sections reveal; pricing + footer correct. Caught and fixed an
  above-the-fold reveal bug (hero CTA invisible until scroll) before shipping.
