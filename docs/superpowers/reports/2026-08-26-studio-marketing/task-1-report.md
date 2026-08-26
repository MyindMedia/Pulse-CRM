# Task 1 report: Schema, capabilities, entitlements, plan caps

Branch: `feat/studio-marketing`. Commit: `1013496` "Marketing module: schema, capabilities, entitlement and plan caps". Pushed to `origin/feat/studio-marketing`.

## What was implemented

Exactly the brief's Task 1 scope (`docs/superpowers/plans/2026-08-26-studio-marketing.md`, `### Task 1` section), Global Constraints applied throughout (no em dashes; `npm test` + `npm run typecheck` before commit).

1. **`convex/lib/accessPolicies.ts`** - added marketing capabilities to every role list:
   - `marketing.read, marketing.edit, marketing.approve`: agency `owner`, agency `admin`, studio `owner`, studio `manager`.
   - `marketing.read, marketing.edit`: `engineer`, `assistant_engineer`, `artist_relations`, `producer`.
   - `marketing.read` only: `intern`, `accountant`.

2. **`convex/lib/entitlements.ts`** - added `"marketing.read"`, `"marketing.edit"`, `"marketing.approve"` to `ENTITLEMENT_FOR_CAPABILITY`, all mapping to `"marketing"`.

3. **`convex/lib/modules.ts`** - added the `marketing` module row (`{ key: "marketing", label: "Marketing", area: "comms", nav: true, blurb: "Scheduled social posts, promos and results" }`) under the Communication group in `MODULES`.

4. **`convex/lib/plans.ts`**:
   - Added `"marketing"` to the `CapabilityKey` union (this union lives in `plans.ts`, not `modules.ts` - see Deviations below).
   - Added `socialAccountCap: number` and `socialPostsPerMonth: number` to `TierLimits`, after `staffCap`.
   - Added `"marketing"` to `STUDIO_CAPS` (every tier at or above `studio` inherits it, per the file's existing "additive bundle" pattern).
   - Set on every one of the 7 `PLAN_LIMITS` tiers: `flow` and `studio` get `socialAccountCap: 3, socialPostsPerMonth: 20`; `pro`, `label`, `enterprise`, `growth`, `agency` get `UNLIMITED` (999_999) for both. See Deviations for why `label` and `enterprise` were included even though the brief's tier list didn't name them.

5. **`convex/usage.ts`** - added `social_accounts -> limits.socialAccountCap` and `social_posts -> limits.socialPostsPerMonth` cases to `capForMetric`.

6. **`convex/schema.ts`**:
   - `orgs.ghl`: `v.optional(v.object({ locationId: v.string(), tokenRef: v.string() }))`, after `defaultRateCutPct`.
   - `artists.okToFeature`: `v.optional(v.boolean())`, after `instagram`.
   - `bookingVisits.postId`: `v.optional(v.id("socialPosts"))`, after `utmSource`.
   - `opsActions.type`: added `v.literal("social_post_draft")` after `v.literal("studio_risk")`.
   - `opsActions.payload`: added fourth union branch `v.object({ kind: v.literal("social_post"), postId: v.id("socialPosts") })`.
   - New tables inserted after `waitlistEntries` (before `membershipPlans`): `socialAccounts`, `promos`, `socialPosts`, verbatim per the brief (fields, unions, indexes).

7. Tests: appended the `marketing capabilities` describe block to `convex/lib/accessPolicies.test.ts`; created `convex/lib/marketingEntitlement.test.ts`, both verbatim from the brief.

## What was tested and results

- `npx vitest run convex/lib` (all of `convex/lib`, 22 files): **192 passed / 192**.
- `npm test` (whole repo, `vitest run`): **1265 passed / 1265, 147 test files**. Nothing outside the touched files broke (confirms no other file enumerates `TierLimits` keys or `PLAN_LIMITS` shape in a way the two new required fields would break).
- `npm run typecheck` (`tsc --noEmit`): **exit 0, no errors**. No `opsActions.ts` / `src/app/(app)/inbox/page.tsx` narrowing fix was needed - the brief anticipated this might be required; the existing `payload.kind === "email"` / similar guards already narrow correctly against the widened union, so nothing was touched there, per the brief's own allowance ("add nothing yet").

## TDD evidence

**RED** - command: `npx vitest run convex/lib/accessPolicies.test.ts convex/lib/marketingEntitlement.test.ts` (run before any implementation, right after adding the two test files verbatim from the brief):

```
 FAIL  convex/lib/accessPolicies.test.ts > marketing capabilities > owner and manager can approve posts
AssertionError: expected [ 'songs.read', 'songs.edit', …(43) ] to include 'marketing.approve'
 FAIL  convex/lib/accessPolicies.test.ts > marketing capabilities > engineer can submit but not approve
AssertionError: expected [ 'songs.read', 'songs.edit', …(16) ] to include 'marketing.edit'
 FAIL  convex/lib/accessPolicies.test.ts > marketing capabilities > intern can read only
AssertionError: expected [ 'songs.read', 'sessions.read', …(7) ] to include 'marketing.read'
 FAIL  convex/lib/marketingEntitlement.test.ts > marketing entitlement > maps every marketing capability to the marketing module
AssertionError: expected null to be 'marketing'
 FAIL  convex/lib/marketingEntitlement.test.ts > marketing entitlement > every paid tier has marketing, with caps only on studio
AssertionError: expected false to be true

 Test Files  2 failed (2)
      Tests  5 failed | 22 passed (27)
```

**GREEN** - command: `npx vitest run convex/lib` (after implementing Steps 3-5):

```
 RUN  v4.1.6 ...

 Test Files  22 passed (22)
      Tests  192 passed (192)
```

Then full suite - command: `npm test`:

```
 Test Files  147 passed (147)
      Tests  1265 passed (1265)
```

And `npm run typecheck`: exit 0, no output (clean).

## Files changed

- `convex/schema.ts`
- `convex/lib/accessPolicies.ts`
- `convex/lib/accessPolicies.test.ts`
- `convex/lib/entitlements.ts`
- `convex/lib/marketingEntitlement.test.ts` (new)
- `convex/lib/modules.ts`
- `convex/lib/plans.ts`
- `convex/usage.ts`

8 files changed, 175 insertions(+), 1 deletion(-). Matches the brief's Step 7 commit file list exactly.

## Self-review findings

- Every capability string, table name, field name, union literal, and index in the brief was used verbatim (`marketing.read/edit/approve`, `socialAccounts`/`promos`/`socialPosts`, `social_post_draft`, `{ kind: "social_post", postId }`, `social_accounts`/`social_posts` metric names).
- Ran a full-repo grep for other consumers of `PLAN_LIMITS` / `TierLimits` (17 files across `convex/` and `src/`) before committing; the full `npm test` run already covers all of them and none broke, so the two new required `TierLimits` fields did not silently invalidate an unrelated exhaustive-shape test.
- Checked the existing `"studio intern is read-only across the board"` test in `accessPolicies.test.ts` (iterates every intern capability and asserts it ends in `.read` or `.own`) - adding `marketing.read` to `intern` satisfies it without modification.
- No YAGNI additions: did not touch `src/lib/features.ts`, `NAV_CAPABILITIES` in `entitlements.ts`, or any UI/nav file - the brief's File Structure table assigns those to a different task, and Task 1's own file list (line 55-62 of the brief) does not include them.
- Diff for every touched file was read back in full before committing (`git diff`) and matches the brief's code blocks character-for-character.

## Deviations from the brief (both minor, both file-location drift, none behavioral)

1. **`capabilitiesForTier` import** - the brief flagged this as the one allowed deviation ("may be exported from `plans.ts` rather than `entitlements.ts`"). In this codebase it is in fact already exported from `convex/lib/entitlements.ts` (re-exported nowhere else), so the test's import exactly as the brief wrote it (`import { entitlementForCapability, capabilitiesForTier } from "./entitlements"`) worked with zero changes. No deviation was actually needed here.

2. **`CapabilityKey` union location** - the brief says "In `convex/lib/modules.ts`: add `"marketing"` to the `CapabilityKey` union". In the current codebase `CapabilityKey` is defined in `convex/lib/plans.ts` and merely re-exported/imported by `modules.ts`. Added `"marketing"` to the actual union in `plans.ts`; the `MODULES` array entry (which the brief also asked for) went into `modules.ts` as specified. Purely a "the code has moved since the brief was written" situation, same category as deviation #1.

## Concerns

1. **`label` and `enterprise` tiers were not explicitly named by the brief.** The brief's sentence is: "Set on every tier: the $0 flow tier and `studio`: `socialAccountCap: 3, socialPostsPerMonth: 20`; `pro`, `growth`, `agency`, and the custom tier: `socialAccountCap: UNLIMITED, socialPostsPerMonth: UNLIMITED`." The codebase has 7 `TierLimits` entries (`flow, studio, pro, label, enterprise, growth, agency`); the brief's enumeration covers 6 of them by name (treating "the custom tier" as `enterprise`, which has `custom: true`) but never mentions `label`. Since `TierLimits.socialAccountCap`/`socialPostsPerMonth` are non-optional, every tier needed a value regardless. I set `label` to `UNLIMITED`/`UNLIMITED`, matching the file's own established pattern (every numeric cap - `roomCap`, `staffCap`, `magicLinkGrantsPerMonth` - is monotonically non-decreasing as tiers go up, and `label` already sits between `pro` and `enterprise`, both UNLIMITED on every other cap). No test exercises `label` or `enterprise` directly for these two fields, so this is inference, not verified requirement. Flagging for controller confirmation; low risk given the monotonicity argument, but it is a real gap in the brief's text rather than something I verified against an explicit instruction.

2. ~~**`social_posts` was not added to `usage.ts`'s `MONTHLY_METRICS` set.**~~ **RESOLVED in Fix round 1 below** (coordinator confirmed this was a real gap). See that section.

Concern 1 (label/enterprise = UNLIMITED) was reviewed by the coordinator and confirmed correct as implemented; no change needed.

## Fix round 1

Coordinator flagged concern 2 as a real gap and asked for it to be fixed before review. Concern 1 was confirmed correct as-is.

**What changed:**

1. `convex/usage.ts` - added `"social_posts"` to `MONTHLY_METRICS` (now `["ai_credits", "email", "sms", "exports", "magic_links", "social_posts"]`). `"social_accounts"` was deliberately left out of the set, so `periodFor("social_accounts", ...)` still returns `"all"` (a live count, not a monthly rate).
2. `convex/lib/marketingEntitlement.test.ts` - added `import { periodFor } from "../usage";` and a third test:

```ts
it("social posts reset monthly, connected accounts do not", () => {
  expect(periodFor("social_posts", Date.UTC(2026, 7, 26))).toBe("2026-08");
  expect(periodFor("social_accounts", Date.UTC(2026, 7, 26))).toBe("all");
});
```

   Tried the direct import first, as the coordinator's message allowed falling back to a new `convex/usage.test.ts` if importing `../usage` (which pulls `convex/_generated/server`) broke under plain vitest. It did not break - `convex/usage.ts`'s Convex-server imports (`query`, `internalQuery`, `internalMutation` from `./_generated/server`) resolved fine under the existing vitest config, consistent with `periodFor` being a plain exported function with no Convex context dependency. No fallback needed; the test stayed in `convex/lib/marketingEntitlement.test.ts` as the coordinator's primary instruction specified.

**Test run** - command: `npx vitest run convex/lib/marketingEntitlement.test.ts`:

```
 RUN  v4.1.6 ...

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Full suite** - command: `npm test`:

```
 Test Files  147 passed (147)
      Tests  1266 passed (1266)
```

(1266 = the prior 1265 plus the one new `periodFor` test.)

**Typecheck** - command: `npm run typecheck`: exit 0, no output (clean).

**Commit:** `9d5abb4` "Usage: social posts meter monthly" (`convex/usage.ts`, `convex/lib/marketingEntitlement.test.ts`; 2 files changed, 6 insertions(+), 1 deletion(-)). Pushed to `origin/feat/studio-marketing`.

Both concerns from the original report are now closed: concern 1 confirmed correct by the coordinator, concern 2 fixed and verified.
