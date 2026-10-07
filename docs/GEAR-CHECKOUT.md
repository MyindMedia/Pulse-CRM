# Gear check-out (barcode and QR)

Growth and Max. Capability key `gearCheckout` (see `convex/lib/pricing.ts`). Every function below checks it and returns `UPGRADE_REQUIRED` on Core. The iOS app must not show plan wording: when a call fails with that code, hide the screen.

## Code format

- Stored on `equipment.barcode`, upper case, 3 to 32 characters of `A-Z 0-9 -`. Generated codes look like `PX-7K3M9Q2T`.
- Unique per studio (index `by_org_barcode`). Two studios may hold the same code.
- The QR payload and the Code 128 text are the bare code. It is an opaque id: no secret, no studio id. It resolves only for a signed-in member of the owning studio. A code from another studio behaves exactly like a code that does not exist.
- Normalise before sending (trim, upper case). The server does it too.

## Convex functions the iOS app calls

All take the signed-in user's token; the studio always comes from auth, never from arguments. Read needs `equipment.read`, write needs `equipment.edit`.

| Function | Kind | Args | Returns |
|---|---|---|---|
| `gearCheckout.lookup` | query | `{ code }` | `null` when not found, else `{ equipmentId, name, category, barcode, status, out }` where `out` is the open check-out or `null` |
| `gearCheckout.checkOut` | mutation | `{ code? , equipmentId?, holder, dueAt?, notes? }` | `{ checkoutId, equipmentId, name }` |
| `gearCheckout.checkIn` | mutation | `{ code?, equipmentId?, notes? }` | `{ checkoutId, equipmentId, name, wasOverdue }` |
| `gearCheckout.listOut` | query | `{}` | open check-outs, overdue first, each with `overdue: boolean` |
| `gearCheckout.overdue` | query | `{}` | only the overdue ones |
| `gearCheckout.history` | query | `{ equipmentId, limit? }` | check-outs for one item, newest first (max 200) |
| `gearCheckout.assignCode` | mutation | `{ equipmentId, code? }` | the code (generated when omitted; an existing code is kept) |
| `gearCheckout.assignMissingCodes` | mutation | `{}` | `{ assigned }` |
| `gearCheckout.labels` | query | `{}` | `[{ equipmentId, name, category, barcode }]` |

`holder` is `{ kind: "member", memberId } | { kind: "client", artistId } | { kind: "session", sessionId } | { kind: "rental", label, artistId? }`.

Errors are `ConvexError` with `data.code`: `NOT_FOUND` (also for another studio's code), `ALREADY_OUT`, `NOT_OUT`, `NOT_AVAILABLE` (maintenance or retired), `BAD_HOLDER`, `BAD_DUE`, `BAD_CODE`, `CODE_TAKEN`, `UPGRADE_REQUIRED`. `data.message` is safe to show.

Check-out sets `equipment.status` to `in_use`; check-in sets it to `available`. Each trip is one `gearCheckouts` row, so history is the item's rows.

## Scanning on the phone

Use the camera (AVFoundation metadata output for `.qr` and `.code128`), pass the string to `lookup`, then show Check out or Check in. Treat a pasted URL ending `?code=...` as the code.

## mirroredTables (not changed by this feature)

`equipment` is already in `MIRRORED_TABLES`; it now has an optional `barcode` field, so the app sees it on the next snapshot. Check `MIRRORED_FIELDS` if it is a whitelist.

`gearCheckouts` is NOT mirrored. To make "who has what" work offline, add it to `MIRRORED_TABLES` in `convex/lib/mirroredTables.ts` with `MIRRORED_CAPABILITY` set to `equipment.read`. It is orgId-first indexed (`by_org_open`), has no money fields, and holds only name snapshots. Until then the app should call `listOut` and `history`, which work online.

## Overdue alerts

`gearCheckout.sweepOverdue` runs every 30 minutes (cron `gear-overdue`). It sends one push per overdue check-out through `notify.toOrg` (web and iPhone), addressed to the holder when the holder is a team member, otherwise to the studio. `overdueNotifiedAt` makes it send once. Studios without the feature are skipped. No SMS is sent: the existing SMS layer texts clients, and gear alerts are staff-facing.
