import type { Doc } from "../_generated/dataModel";
import { sameEmail } from "./emailKey";

/* ============================================================
   What "signed" means on a split sheet.

   A contributor has signed only when the public /sign/[token] flow stamped
   `signedAt` (with the signature, kind, font and browser) onto their row.
   The browser can never set it: `splitSheets.upsert` carries every
   signature field over from the stored row.

   A row with `signed: true` and no `signedAt` was ticked by hand before
   this fix (or lost its evidence on an old re-save). It is shown as
   "marked by studio", never as signed by the person, and it does not count
   towards auto-executing a sheet.

   A sheet is executed (royalties allocate, the release gate opens) when it
   is either `fully_executed` (everyone signed by link) or
   `marked_by_studio` (the owner recorded paper signatures, with a note).
   ============================================================ */

export type SplitContributor = Doc<"splitSheets">["contributors"][number];
export type SplitStatus = Doc<"splitSheets">["status"];

/** The person signed it themselves, through their link. */
export function signedByPerson(c: { signedAt?: number }): boolean {
  return typeof c.signedAt === "number";
}

/** A hand tick from before this fix: `signed` without any signature record. */
export function legacyHandTick(c: { signed: boolean; signedAt?: number }): boolean {
  return c.signed && !signedByPerson(c);
}

/** Every contributor signed by link. False for an empty sheet. */
export function everyoneSigned(contributors: { signedAt?: number }[]): boolean {
  return contributors.length > 0 && contributors.every(signedByPerson);
}

/** Royalties allocate and the release gate opens. */
export function isSheetExecuted(status: string | undefined | null): boolean {
  return status === "fully_executed" || status === "marked_by_studio";
}

/** What screens should call the sheet. A `fully_executed` sheet that is
 *  missing a real signature (hand-ticked before this fix) is shown as marked
 *  by the studio, never as signed by everyone. */
export function displayStatus(sheet: Pick<Doc<"splitSheets">, "status" | "contributors">): SplitStatus {
  if (sheet.status === "fully_executed" && !everyoneSigned(sheet.contributors)) return "marked_by_studio";
  return sheet.status;
}

/** The signature record on a row. Copied from the stored sheet, never from the browser. */
const SIGNATURE_FIELDS = ["signed", "signedAt", "signature", "signatureKind", "signatureFont", "signedFromUa"] as const;

export type IncomingContributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  pro?: string;
  ipi?: string;
  email?: string;
  /** Position of this row in the stored sheet the browser loaded, so a row
   *  whose email was corrected still matches its stored self. */
  fromIndex?: number;
};

export type MergeResult = {
  contributors: SplitContributor[];
  /** A term every signer agreed to changed: a name, role or share, or a
   *  contributor was added or removed. */
  termsChanged: boolean;
  /** Signature records that no longer cover the sheet (cleared from the rows). */
  cleared: SplitContributor[];
  /** Signed rows whose email changed (the signature was kept). Royalty shares
   *  are keyed by email, so callers log these. */
  signedEmailChanges: { name: string; from: string; to: string }[];
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function sameTerms(a: SplitContributor, b: IncomingContributor): boolean {
  return (
    norm(a.name) === norm(b.name) &&
    norm(a.role) === norm(b.role) &&
    a.masterPct === b.masterPct &&
    a.publishingPct === b.publishingPct
  );
}

function blankSignature(row: Omit<SplitContributor, typeof SIGNATURE_FIELDS[number]>): SplitContributor {
  return { ...row, signed: false };
}

/**
 * Merge the browser's contributor list onto the stored one.
 *
 * - Signature fields always come from the stored row (matched by email, then
 *   by `fromIndex`). The browser cannot add, alter or drop them.
 * - Email, PRO and IPI corrections never clear a signature.
 * - If any agreed term changed (a name, role, master % or publishing %, or a
 *   contributor added or removed), every signature on the sheet stops
 *   covering it: each signature is cleared from its row and returned in
 *   `cleared`, for the caller to keep in the signature history. Hand ticks
 *   from before this fix are cleared the same way.
 */
export function mergeContributors(stored: SplitContributor[], incoming: IncomingContributor[]): MergeResult {
  const used = new Set<number>();
  const match: (number | null)[] = incoming.map(() => null);

  // 1. Email match (a signer is tied to the address their link went to).
  incoming.forEach((c, i) => {
    if (!c.email) return;
    const j = stored.findIndex((s, k) => !used.has(k) && s.email && sameEmail(s.email, c.email));
    if (j >= 0) { match[i] = j; used.add(j); }
  });
  // 2. Position the browser loaded it from (an email was corrected, or no email).
  incoming.forEach((c, i) => {
    if (match[i] !== null) return;
    const j = c.fromIndex;
    // A stored row already claimed by an email match above is never paired twice.
    if (typeof j !== "number" || !Number.isInteger(j) || j < 0 || j >= stored.length || used.has(j)) return;
    match[i] = j; used.add(j);
  });

  const termsChanged =
    incoming.length !== stored.length ||
    used.size !== stored.length ||
    incoming.some((c, i) => match[i] === null || !sameTerms(stored[match[i]!], c));

  const fields = (c: IncomingContributor) => ({
    name: c.name,
    role: c.role,
    masterPct: c.masterPct,
    publishingPct: c.publishingPct,
    pro: c.pro,
    ipi: c.ipi,
    email: c.email,
  });

  if (!termsChanged) {
    const contributors = incoming.map((c, i) => {
      const s = stored[match[i]!];
      const carried: Partial<SplitContributor> = {};
      for (const f of SIGNATURE_FIELDS) {
        if (s[f] !== undefined) (carried as Record<string, unknown>)[f] = s[f];
      }
      return { ...fields(c), ...carried, signed: s.signed } as SplitContributor;
    });
    const signedEmailChanges = incoming.flatMap((c, i) => {
      const st = stored[match[i]!];
      if (!(st.signed || signedByPerson(st))) return [];
      const from = st.email ?? "";
      const to = c.email ?? "";
      return sameEmail(from, to) || (!from && !to) ? [] : [{ name: c.name, from, to }];
    });
    return { contributors, termsChanged: false, cleared: [], signedEmailChanges };
  }

  const cleared = stored.filter((s) => s.signed || signedByPerson(s));
  const contributors = incoming.map((c) => blankSignature(fields(c)));
  return { contributors, termsChanged: true, cleared, signedEmailChanges: [] };
}
