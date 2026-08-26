# Task 5 Report: Per-platform Post Validation Rules

## Summary

Implemented two pure TypeScript files for the Pulse Studio Marketing module: `convex/marketing/rules.ts` (64 lines) and `convex/marketing/rules.test.ts` (27 lines). Task completed on time with all tests passing.

## Implementation

### Files Created

1. **convex/marketing/rules.ts**
   - Exports `MediaKind` type (image | video)
   - Exports `captionLimit(platform: Platform): number` function that returns per-platform character limits
   - Exports `validateForPlatform(platform, input): string[]` function that validates post content for each of 10 platforms
   - Implements platform-specific rules: TikTok/YouTube require exactly one video; Instagram allows up to 10 photos; Google rejects phone numbers; Threads allows up to 20 items; Facebook and LinkedIn accept text only
   - All caption limits (300 to 63,206 characters) match the brief exactly
   - Phone regex matches US/Canada format with optional +1 prefix and various separators

2. **convex/marketing/rules.test.ts**
   - 5 test cases covering all platform rules
   - Tests verify TikTok/YouTube video requirements, Instagram media constraints, Google phone rejection and caption limits, per-platform caption limits (Bluesky 300, Threads 500, Instagram 2200), and Facebook/LinkedIn text-only acceptance
   - All assertions match the brief exactly

## Test Results (TDD Cycle)

**RED Phase:** npx vitest run convex/marketing/rules.test.ts
```
Error: Cannot find module './rules' imported from convex/marketing/rules.test.ts
Test Files 1 failed (1)
```

**GREEN Phase:** npx vitest run convex/marketing/rules.test.ts
```
Test Files 1 passed (1)
Tests 5 passed (5)
Duration 162ms
```

**Full Test Suite:** npm test
```
Test Files 150 passed (150)
Tests 1292 passed (1292)
Duration 5.39s
```

**TypeCheck:** npm run typecheck
```
(no output = no errors)
```

## Self-Review

The implementation matches the brief exactly:
- `MediaKind` type definition is correct
- `captionLimit` function returns correct limits for all 10 platforms
- `validateForPlatform` logic covers all platform-specific constraints
- Phone regex uses the exact pattern from the brief
- Platform labels are correct and match GHL API conventions
- All test cases pass without modification
- No em dashes in any comments or strings (compliance with global constraint)
- Pure TypeScript with no Convex dependencies except type import from ghl.ts

## Changes Made

```
2 files changed, 91 insertions(+)
convex/marketing/rules.test.ts   27 lines (new)
convex/marketing/rules.ts        64 lines (new)
```

## Commits

1. **5e77e31** Marketing: per-platform post validation rules
   - Pushed to origin/feat/studio-marketing successfully

## Concerns

None. All tests pass, TypeScript compiles cleanly, and code matches the brief specification exactly.
