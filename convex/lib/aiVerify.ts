/* ============================================================
   AI draft verifier - a deterministic gate before any AI-written
   client message reaches a human.

   The model writes copy; this checks it against the facts BEFORE the
   draft is surfaced for approval. If it fails, the caller keeps the
   deterministic template (safe degradation) instead of shipping a
   hallucination. Pure + unit-tested - no model, no ctx.

   It catches the three things that actually burn studios:
     1. Placeholder tokens that leaked into the body ("[payment link]",
        "{{name}}", "TODO").
     2. Dollar amounts the model invented (any $ figure not in the
        allowed set we provided).
     3. References to anything on a forbidden list (e.g. another
        studio's name) - belt-and-suspenders over tenant isolation.
   ============================================================ */

export type DraftFacts = {
  /** Money strings allowed to appear, e.g. ["$540", "$1,200"]. When provided
   *  (even as an empty array), any $ amount NOT in this set is rejected; when
   *  omitted, amounts are not checked. */
  allowedMoney?: string[];
  /** Strings that must never appear in the body (other studio names, etc.). */
  forbidden?: string[];
};

export type VerifyResult = { ok: boolean; issues: string[] };

/* Obvious un-filled merge/placeholder patterns that must never go out. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]*\b(?:link|name|amount|url|date|time|invoice|studio|deposit)\b[^\]]*\]/i,
  /\{\{[^}]*\}\}/,
  /\bTODO\b/,
  /\bLOREM\b/i,
  /\bYOUR_[A-Z_]+/,
  /\bINSERT\b[^.]{0,20}\bhere\b/i,
];

const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;

/** All dollar amounts found in the text, normalized (whitespace removed). */
export function findMoney(text: string): string[] {
  return (text.match(MONEY_RE) ?? []).map((m) => m.replace(/\s/g, ""));
}

/** Numeric core of a money string, for set comparison ("$1,200" -> "1200"). */
function moneyKey(s: string): string {
  return s.replace(/[^\d.]/g, "");
}

/** Verify an AI draft against known facts. Pure. */
export function verifyDraft(text: string, facts: DraftFacts = {}): VerifyResult {
  const issues: string[] = [];
  if (!text || !text.trim()) return { ok: false, issues: ["empty draft"] };

  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(text)) issues.push(`placeholder token (${re.source})`);
  }

  if (facts.allowedMoney !== undefined) {
    const allowed = new Set(facts.allowedMoney.map(moneyKey));
    for (const m of findMoney(text)) {
      if (!allowed.has(moneyKey(m))) issues.push(`unverified amount ${m}`);
    }
  }

  for (const f of facts.forbidden ?? []) {
    if (f.trim() && text.toLowerCase().includes(f.trim().toLowerCase())) {
      issues.push(`forbidden reference "${f}"`);
    }
  }

  return { ok: issues.length === 0, issues };
}
