# Feature truth: does Pulse do what it says?

Audit of 2026-11-12 against the production branch (`main`, commit `4a3b5ba`). Asked for by the owner: "set up agents to ensure the features are actually real and fix any that isn't."

Seven reviewers read the code for every claim Pulse makes: each module blurb and plan line in `convex/lib/pricing.ts` and `convex/lib/modules.ts`, the public pages, and every email, text and confirmation screen sent to a studio's clients. Two more reviewers then tried to disprove each reported gap. A feature counted as real only if a user can reach it and it does what the words say.

| | Count |
|---|---|
| Claims checked | 293 |
| True as worded | 125 |
| Reported as a gap, then shown to be real | 3 |
| Confirmed gaps | 152 |
| Not settled | 13 |

Confirmed gaps by kind: 96 overstated, 34 not built, 21 messages that say something untrue at the moment they are sent, 1 other.

Confirmed gaps by fix: 98 wording only, 38 small or medium bug fixes, 16 high risk (money, cards, access, wages, signatures).

- `FIX-PLAN.md`: every confirmed gap, grouped into five batches, with the rules for fixing them.
- `audit-2026-11-12.json`: the full record with evidence lines and both reviewers' notes.

Limits: the code was read, the running product was not exercised. Production settings (Stripe, the text-message provider, each studio's own settings) were not checked. The audit reflects `main` at the commit above.
