# Pulse native macOS app: design

**Date:** 2026-09-04
**Status:** approved, implementation not started
**Supersedes:** the "shell, not a bundle" decision in `~/Dev/pulse-desktop/docs/PLAN.md`

## Why

The Tauri shell loads `pulse.myindsound.com` over the network. With no internet it
is a blank window: there is nothing local in it at all. Lawrence wants a real Mac
application that works when the studio's connection dies, keeps the data locally,
and reconciles when the connection comes back.

## Decisions

Four, all made 2026-09-04 after measuring the codebase.

1. **Native SwiftUI rewrite**, not an offline-first web core. Every module gets
   rebuilt in Swift. This was chosen with the cost stated: 56,455 LOC of module UI
   across 298 files, 75 routes, 90 tables, 864 Convex functions, and a web app that
   keeps moving underneath. Estimated 18-30 months to parity for one developer.
2. **Purpose-built delta sync** over Convex, not query mirroring and not
   read-only offline.
3. **macOS first, iOS after.** The SwiftUI project is structured multiplatform
   from day one but only the Mac target ships first. The Tauri shell stays alive
   as the interim app and is retired per-platform as native replaces it.
4. **Server-authoritative intent replay.** Offline edits queue as intents, not as
   rows. The server re-runs the real mutation on reconnect, so business rules
   apply exactly as they do online. Rejections surface in a queue.

## Rejected, with reasons

**PowerSync's Convex integration.** It is experimental, and it requires
reimplementing read authorization as Sync Streams instead of Convex functions.
Pulse's org scoping, RBAC tiers, agency scoping and collaborator grants live
inside 237 queries behind `convex/lib/access.ts`. Re-expressing that in a second
authorization language is where one studio's data leaks into another's.

**Adding `updatedAt` to every table.** Only 14 of 90 tables have `updatedAt`, 23
have `createdAt`, and 1 has a soft-delete marker. There are 1,618 direct `ctx.db`
write call sites (1,099 inserts, 433 patches, 85 deletes, 1 replace) and no custom
function wrapper. Hand-stamping is not viable.

**Convex Streaming Export / `document_deltas`.** It is deployment-wide and
admin-authenticated. A per-studio client cannot call it without either leaking
every org's data or rebuilding authorization in a middleware tier.

## Architecture

### Repository

New repo `MyindMedia/Pulse-Native` at `~/Dev/pulse-native`, outside Dropbox
(spaces in the Pulse path break Xcode script phases; Dropbox syncs build output).

Swift package workspace, three targets:

- `PulseKit` - models, SQLite store, sync engine, Convex bindings, auth. All
  logic lives here so the iOS target is nearly free later.
- `PulseMac` - the macOS app. macOS 14+.
- `PulseiOS` - later, same PulseKit.

Dependencies: `convex-swift`, `clerk-ios`, `clerk-convex-swift`, `GRDB.swift`.
Toolchain: Xcode 26.3, Swift 6.2.4.

### The change feed

`convex-helpers` Triggers fire on `insert`, `patch`, `replace` and `delete`,
atomically inside the same mutation.

1. Add `convex-helpers`. New `convex/functions.ts` exports a triggered `mutation`
   and `internalMutation` built with `customMutation(rawMutation, customCtx(triggers.wrapDB))`.
2. Codemod the 147 files importing `./_generated/server` to import from
   `./functions` instead.
3. New `changeLog` table: `{ orgId, tableName, docId, op, ts }`, indexed
   `by_org_ts`. One trigger per mirrored table appends a row. Deletes become
   tombstones for free.
4. New `convex/sync.ts` exposing `pullChanges({ since, tables, limit })`. It is an
   ordinary org-scoped Convex query and goes through `resolveViewer` /
   `requireCapability` like everything else. **Authorization stays in Convex.**
5. Retention: prune `changeLog` past a horizon; a client whose cursor is older
   than the horizon does a full re-snapshot.

**Known limitation, documented deliberately:** triggers do not fire for edits made
in the Convex dashboard or via `npx convex import`. A manual dashboard row-edit
will not reach clients until that row changes again through a mutation.

### Client data flow

- **Reads** come from GRDB SQLite, always. The UI never awaits the network.
- **Live**, when online: Convex subscriptions for the visible screen write through
  into SQLite, so the app stays realtime.
- **Catch-up** on launch and on reconnect: drain `pullChanges` per-table cursor.
- **Writes** append an intent to `outbox` (`mutationName`, `argsJSON`,
  `createdAt`, `attempts`), apply an optimistic local row, and replay in order on
  reconnect. Server rejections move to `outbox_rejects` and surface as "Needs
  attention" with the server's own reason.

### Codegen

`tools/swiftgen` reads `convex/schema.ts` and emits Swift structs, GRDB
migrations, and typed mutation-argument builders. This is not optional. Ninety
hand-typed tables that must be re-typed on every web-side schema change is how
this project dies quietly in month seven.

## Error handling

Three states, always visible: **Online**, **Offline (N queued)**, **N need
attention**. The 34 Convex files that call external services (Stripe, GHL/Twilio,
Resend, AI) are online-only; their controls disable offline and say why.

## Testing

- PulseKit unit tests against a fake Convex client.
- Golden tests on `swiftgen` output, so schema drift fails a test rather than a screen.
- An offline scenario harness: snapshot, disconnect, edit, reconnect, assert
  convergence, including the rejection path.
- Per-module parity checklists against the web app.

## Sequence

| Phase | Contents |
|---|---|
| P0 | Skeleton, Clerk sign-in, Convex client, brand port |
| P1 | Backend change feed (triggers, `changeLog`, `sync.pullChanges`) |
| P2 | Sync engine, outbox, `swiftgen` |
| W1 | settings, roster, studio |
| W2 | today, schedule, calendar, bookings |
| W3 | clock, visitors, inventory, rentals, packages |
| W4 | payments, expenses, payroll, reports |
| W5 | songs, releases, licensing, pipeline |
| W6 | inbox, dashboard, brief, software, agent, marketing, patch |

Waves follow the table dependency layers: nothing is mirrored before the tables it
references. `sessions` sits at layer 3, so `artists`, `rooms`, `orgs` and
`bookableServices` must land first.

P0-P2 end with a proof on one table, `artists`: sign in, mirror, disconnect, edit,
reconnect, watch it land. If that is not clean, nothing after it matters.

### Two modules that will not behave

- **`patch` is 10,837 LOC**, the largest module, and it is a React Flow canvas.
  SwiftUI has no equivalent. Treat it as its own project, scheduled last.
- **`marketing` is 7,139 LOC** and is inherently online (GHL, social posting).
  Most of it stays online-only regardless of platform.

## Quality bar

Judged against **Things 3**: launch-to-interactive under 400ms with the network
off, and zero dropped writes across 1,000 queued offline mutations that all
converge after reconnect. UI pieces are judged blind against Things 3 by a
separate critic.
