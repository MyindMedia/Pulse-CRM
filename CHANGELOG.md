# Changelog

## Database Migration: Supabase → Convex — COMPLETE

### Completed
- [x] Migrate all SaaS Build Pack documents from Supabase to Convex references.
- [x] Delete `SaaS Build Pack/09-Supabase-SQL-Starter.sql` and create `09-Convex-Schema-Starter.ts`.
- [x] Create `convex/schema.ts` with full TypeScript schema (tenants, profiles, roles, permissions, clients, projects, sessions, invoices, payments, etc.).
- [x] Create `src/components/providers/convex-provider.tsx` with ConvexReactClient.
- [x] Wire ConvexClientProvider into root layout (`src/app/layout.tsx`).
- [x] Remove `@supabase/ssr` and `@supabase/supabase-js` packages; install `convex`.
- [x] Delete all Supabase code: `src/lib/db/supabase-*.ts`, `supabase/` directory, `src/app/api/auth/` routes.
- [x] Simplify middleware (Convex handles auth client-side).
- [x] Update `.env.local.example` with Convex env vars.
- [x] Rewrite auth pages and tenant page with Convex TODOs.
- [x] Update webhook route to remove Supabase dependency.
- [x] Update all code comments referencing Supabase.

---

## Phase 5: Dashboard & Workflow Modules — COMPLETE

### Completed
- [x] Enhance the dashboard with KPI cards (lead response, booking rate, no-show %, overdue invoices).
- [x] Add pipeline stage distribution bar chart to dashboard.
- [x] Add upcoming sessions panel to dashboard.
- [x] Implement the client management module (CRM).
  - Client list with sortable columns, search, pagination
  - Summary KPI cards (total clients, active/leads, lifetime revenue)
  - Add new client dialog with full form
  - Client detail page with profile, contact info, overview stats, notes
  - Client timeline with activity feed
  - Tabbed detail view (Timeline, Projects, Invoices)
  - Row actions dropdown (view, edit, book session, create invoice, archive)
  - Status badges and tag chips
- [x] Build the Kanban-style pipeline board.
  - 7-stage pipeline: Inquiry > Qualified > Proposal > Booked > In Session > Delivered > Upsell
  - HTML5 drag-and-drop to move deals between stages
  - Deal cards with client info, service type, value, probability, due date
  - Stage value totals and deal counts
  - New deal dialog with client, service type, stage, value, probability, due date
  - Edit deal by clicking card
  - Summary KPI cards (pipeline value, weighted value, open deals)
- [x] Create the session scheduling calendar (Bookings).
  - Week view calendar with daily session columns
  - Session cards with client, service, time, location, status
  - Tabs: Week View / Upcoming / Past
  - 6 session statuses: requested, confirmed, in progress, completed, cancelled, no show
  - Book session dialog with client, service, date/time, location, status, notes
  - Edit session by clicking card
  - Summary KPI cards (upcoming, confirmed, completed, no-shows)
- [x] Implement the invoice and payment tracking module.
  - Invoice data table with sortable columns, search, pagination
  - Deposit / milestone / final payment types
  - 5 invoice statuses: draft, sent, paid, overdue, cancelled
  - Overdue date highlighting
  - Row actions (view, edit, send, mark paid, send reminder, cancel)
  - New invoice dialog with client, project, amount, type, status, due date
  - Summary KPI cards (outstanding, collected, overdue count, drafts)
- [x] Enable dark mode as default theme.
- [x] Upgrade sidebar with icons and active route highlighting.
- [x] Add dynamic page title in header.
- [x] Fix Next.js 16 async cookies() compatibility in server client.

---

## Phase 4: GHL Adapter & Webhooks — COMPLETE

### Completed
- [x] Build a secure server-side adapter for the GHL API.
- [x] Create a webhook receiver for incoming GHL events.
- [x] Implement logic for syncing contacts and opportunities.
- [x] Set up secure storage for GHL API keys.

---

## Phase 3: Core UI & Component Development — COMPLETE

### Completed
- [x] Build the main application layout (sidebar, header, content area).
- [x] Develop reusable UI components.
- [x] Create initial pages for core features (Dashboard, CRM, Pipeline, Bookings, Invoices).
- [x] Implement a consistent and polished design system.

---

## Phase 2: Authentication & Tenant Model — COMPLETE

### Completed
- [x] Implement email/password authentication.
- [x] Create authentication UI components (Login, Signup).
- [x] Implement route protection middleware.
- [x] Implement user profile and tenant creation flow.
- [x] Implement Role-Based Access Control (RBAC).

---

## Phase 1: Project Setup & DB Schema — COMPLETE

### Completed
- [x] Initialize Next.js project.
- [x] Set up Convex project and database schema.
- [x] Install and configure necessary dependencies.

---

## Next: Phase 6 — AI Agents & Control Plane
- [ ] Design and implement the AI control plane for managing agent actions.
- [ ] Define the domain agent contracts for the Booking and Pipeline agents.
- [ ] Implement the Booking agent to handle automated booking requests.
- [ ] Implement the Pipeline agent to manage and update the sales pipeline.
- [ ] Create audit logs and guardrails for all AI agent actions.

## Next: Phase 7 — Testing, Deployment & Handoff
- [ ] Write unit and integration tests for critical modules.
- [ ] Create a comprehensive test plan for manual QA.
- [ ] Develop a deployment checklist for production launch.
- [ ] Set up logging, monitoring, and error handling.
- [ ] Document the final architecture and provide a developer handoff.
