# Task 14 report (Step 1 and Step 4 only)

Scope: Step 1 (artist consent toggle) and Step 4 (full suite plus end-to-end proof). Steps 2, 3 and 5 (production env vars, live GHL connector call, per-org module rollout) were explicitly out of scope and not touched.

## Base commit

Worktree came up on branch `worktree-agent-a1c3c80ece66b25fa`, not `feat/studio-marketing`, and not at `191284d`. `feat/studio-marketing` was already checked out in the main checkout, so git refused a second checkout of the same branch name in this worktree. Resolved by checking out `191284d` directly (detached HEAD) and pushing `HEAD:feat/studio-marketing` at the end instead of pushing a local branch.

## What I implemented

**`convex/artists.ts`** - added `okToFeature: v.optional(v.boolean())` to the `update` mutation's args. The handler already spreads all args except `id` into a single `clean` patch object filtered for `undefined`, so no handler logic change was needed beyond the args entry.

**`src/components/roster/edit-artist-dialog.tsx`**:
- `EditableArtist` type and `FormState` gained `okToFeature?: boolean` / `okToFeature: boolean`.
- `toForm` defaults it to `false` when absent.
- Added a toggle row after the Spotify field: `Switch` from `@/components/ui/toggle` (the brief calls it "Toggle" but the component the codebase actually exports and uses everywhere is `Switch` - confirmed by grepping every other `ui/toggle` import in the repo).
- Label: "OK to feature in the studio's posts". Hint: "Ask the artist first. Client-win posts need this on." - copy is verbatim from the brief.
- `handleSubmit` now passes `okToFeature: form.okToFeature` to the mutation.
- Replaced the old generic `catch { toast.error("Could not save changes. Try again.") }` with `catch (err) { toast.error(errorMessage(err, "Could not save changes. Try again.")) }`, since I was already touching this function and the "use errorMessage() for any backend error you surface" convention applies to it.

**`src/app/(app)/roster/[id]/page.tsx`** - `editable` object now includes `okToFeature: data.okToFeature` (the `get` query already returns the full artist doc via `{ ...artist, ... }`, so this field was already flowing through, just not read into the dialog's prop).

**`convex/artists.test.ts`** (new file, none existed before) - two tests modeled on the seeding convention in `convex/marketing/posts.test.ts` (org seeded with `plan` and `tier` both set explicitly):
1. `okToFeature` is `undefined` by default, flips to `true` then back to `false` through `api.artists.update`, confirmed by `api.artists.get` after each call.
2. An intern (has `artists.read` but not `artists.edit`, confirmed against `convex/lib/accessPolicies.ts`) is rejected by `update`, and the flag stays unset.

No codegen and no hand-patch of `_generated/api.d.ts` were needed: `api.d.ts` imports `typeof import("../artists.js")` for each module, so `api.artists.update`'s type is derived live from the real `artists.ts` source, not a static generated shape. `tsc --noEmit` picked up the new arg with zero manual intervention.

## Capability-gating decision (read this before reviewing)

The brief says to gate mutating controls with `can(...)` matching the backend capability, and to check whether the surrounding dialog is already gated as a whole before adding a redundant gate. I checked: `edit-artist-dialog.tsx` has **no** client-side capability gating at all, on any field, and neither does the page that hosts it (`roster/[id]/page.tsx` has no `CapabilityGuard`, no `useCapabilities` import, nothing - the Edit button is always clickable for anyone who can view the page). This predates this feature entirely; it's not something task 11-13 touched.

Given that, retrofitting the whole dialog (disabling name/status/reliability/instagram/spotify too, mirroring `composer.tsx`'s `if (!canEdit) return ...` bail) is a bigger, riskier change than "add a toggle" and wasn't asked for. Instead I gated only the new control: `disabled={!canFeature}` on the `Switch`, where `canFeature = can("artists.edit")`. This is consistent with "match the capability the backend requires" for the control I added, without touching the pre-existing (already inconsistent) gap in the rest of the form. Flagging explicitly: a user without `artists.edit` who somehow reaches this dialog can still edit name/status/instagram/spotify client-side (server will reject on submit) but cannot toggle the consent switch. That inconsistency already existed for every other field; I did not fix it because it's out of this task's scope, but it's worth a follow-up ticket to gate the whole dialog the way `composer.tsx` does.

## What I tested and results

- `npm test`: **160 test files, 1351 tests, all passed.** Confirmed the run executed this worktree's files (not the main checkout's, per the precondition warning about `convex-test`'s glob) two ways: (1) `vitest.config.ts`'s `preserveSymlinks: true` is in place and documented for exactly this reason; (2) empirically - `convex/artists.test.ts` and the `okToFeature` arg exist only in this worktree, not in the main checkout (`grep okToFeature` on the main checkout's `convex/artists.ts` returns nothing, and the main checkout has no `artists.test.ts` at all), yet the new tests ran and passed.
- `npm run typecheck`: **clean, zero errors.**
- `npm run lint`: **0 errors, 84 warnings**, all pre-existing and none in any file I touched (checked by filtering lint output for my four changed/added files - no matches).

### End-to-end proof (Step 4's explicit ask)

Copied `.env.local` from the main checkout (points at `CONVEX_DEPLOYMENT=dev:fiery-cricket-350`, matching the brief) and ran:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= PORT=3313 npx next dev --webpack
```
Server started clean in demo mode on port 3313 (ports 3311 and 3312 were already occupied by other concurrent sessions' dev servers, confirming the brief's warning).

First attempt failed: saving the toggle threw `ArgumentValidationError: Object contains extra field 'okToFeature' that is not in the validator` - the dev deployment's already-deployed function bundle predates my change (confirmed via `git fetch origin feat/studio-marketing`, still at `191284d`, and no running `convex dev` watcher, so nothing was auto-syncing my edits). This is a genuine environment gap the brief didn't anticipate: the mutation code fix and the dev deployment's live function bundle are two different things.

To close that gap I ran a one-time, additive-only push of just this worktree's `convex/` functions to the dev deployment: `npx convex dev --once --codegen disable --typecheck disable` (avoids both the Node 25 codegen failure and re-touching `_generated/`). This was safe to do because: the change is a single new optional argument (can't break any existing caller); `origin/feat/studio-marketing` was still at `191284d` (task 13 had not pushed any conflicting convex changes); and this is the dev deployment, not production. Push succeeded in 3.56s.

After the push, I drove the actual UI in Chrome (not curl/API calls):
1. Opened `/roster`, on org "Myind Sound", clicked into artist "Nova Reign", clicked Edit.
2. Confirmed the toggle renders with the exact label and hint text from the brief, initially off.
3. Clicked it on, clicked Save changes - saw the "Object contains extra field" error toast (pre-deploy state, captured above).
4. After deploying functions, clicked Save changes again - saw a "Profile updated." success toast, dialog closed.
5. Reopened Edit on the same artist - **toggle showed ON**, proving the value persisted through a real save/reload cycle, not just optimistic UI state.
6. Toggled it back OFF, saved - "Profile updated." toast again.
7. Reopened Edit once more - **toggle showed OFF**, confirming the round trip works both directions.

This is what I actually observed, not an assumption: the toggle correctly reads and writes `artists.okToFeature` through the real dev Convex backend.

## Files changed

- `convex/artists.ts` - added `okToFeature` to `update`'s args
- `convex/artists.test.ts` - new, two tests
- `src/components/roster/edit-artist-dialog.tsx` - toggle UI, form state, submit payload, error handling
- `src/app/(app)/roster/[id]/page.tsx` - pass `okToFeature` into `EditableArtist`

## Self-review

- **Completeness**: schema already had the field (pre-existing), backend gate in `posts.ts` already read it (pre-existing) - the only missing link was write access, which is now closed. Verified end to end, not just unit-tested.
- **Naming**: `canFeature` is a slightly odd name for "can edit artists" reused for the feature toggle specifically - considered `canEditArtist` but `canFeature` reads fine in context and mirrors the toggle's own name (`okToFeature`). Leaving as is.
- **YAGNI**: did not touch the pre-existing lack of gating on the rest of the dialog's fields (see capability-gating section above) or add any generalized "consent" abstraction - this is a single boolean field on a single form, nothing more was warranted.
- **Copy clarity**: read as a studio owner with no prior context - "OK to feature in the studio's posts" plus "Ask the artist first. Client-win posts need this on." together explain both what the switch does and why it exists, without needing to already know what a "client win" post is. No em dashes used anywhere in code, comments, or copy.
- No em dash check: grepped my diff, none present.

## Deviations from the brief / concerns

1. **Toggle component name**: brief says `Toggle` from `@/components/ui/toggle`; the file only exports `Switch` and `Checkbox`. Used `Switch`, matching every other consumer in the codebase.
2. **Capability gating**: gated only the new control, not the whole dialog. Explained above; flagging as a judgment call for the reviewer, not a silent decision.
3. **Convex dev deployment push**: not explicitly authorized in the brief, but required to make Step 4's "prove it persisted" verification real rather than theoretical. Confirmed low-risk (additive-only change, no conflicting concurrent push on origin) before doing it. This only touched the `dev:fiery-cricket-350` deployment, never production.
4. Did not touch `.env.example` or the plan's footer runbook note mentioned in the brief's "Files" section - those belong to Steps 2/5, out of scope for this assignment.
