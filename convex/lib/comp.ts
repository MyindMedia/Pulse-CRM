/* ============================================================
   Comped / discounted sessions - the cost math.

   A studio often gives away or discounts a session (artist
   development, a makegood, a referral, charity). Today that just looks
   like a low rate; nothing records that it WAS a comp, why, or what it
   cost the studio in foregone revenue. This pure module is the cost
   layer: given a session's list value vs what was actually charged, it
   computes the foregone revenue and rolls a set of sessions up into a
   comp summary. Pure + unit-tested; the caller passes org-scoped data.
   ============================================================ */

/** Canonical comp reasons offered in the UI (free text is still allowed). */
export const COMP_REASONS = [
  "artist_development",
  "makegood",
  "referral",
  "charity",
  "promo",
  "internal",
  "other",
] as const;
export type CompReason = (typeof COMP_REASONS)[number];

export type CompSession = {
  artistId?: string;
  rateCents: number;
  listValueCents?: number;
  compType?: "comped" | "discounted";
  compReason?: string;
};

/** Foregone revenue on one session: list value minus what was charged.
 *  Zero for a normal (non-comp) session or when no list value is set. */
export function foregoneCents(s: CompSession): number {
  if (!s.compType || s.listValueCents == null) return 0;
  return Math.max(0, s.listValueCents - (s.rateCents || 0));
}

export type CompSummary = {
  compedCount: number;
  discountedCount: number;
  totalForegoneCents: number;
  byReason: { reason: string; count: number; foregoneCents: number }[];
  byClient: { artistId: string; count: number; foregoneCents: number }[];
};

/** Roll a set of sessions up into a comp summary (counts, total foregone,
 *  breakdown by reason and by client). Non-comp sessions are ignored. */
export function summarizeComps(sessions: CompSession[]): CompSummary {
  let compedCount = 0;
  let discountedCount = 0;
  let totalForegoneCents = 0;
  const reasonMap = new Map<string, { count: number; foregoneCents: number }>();
  const clientMap = new Map<string, { count: number; foregoneCents: number }>();

  for (const s of sessions) {
    if (!s.compType) continue;
    const fg = foregoneCents(s);
    if (s.compType === "comped") compedCount++;
    else discountedCount++;
    totalForegoneCents += fg;

    const reason = s.compReason?.trim() || "other";
    const r = reasonMap.get(reason) ?? { count: 0, foregoneCents: 0 };
    r.count++;
    r.foregoneCents += fg;
    reasonMap.set(reason, r);

    if (s.artistId) {
      const c = clientMap.get(s.artistId) ?? { count: 0, foregoneCents: 0 };
      c.count++;
      c.foregoneCents += fg;
      clientMap.set(s.artistId, c);
    }
  }

  const byReason = Array.from(reasonMap.entries())
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.foregoneCents - a.foregoneCents);
  const byClient = Array.from(clientMap.entries())
    .map(([artistId, v]) => ({ artistId, ...v }))
    .sort((a, b) => b.foregoneCents - a.foregoneCents);

  return { compedCount, discountedCount, totalForegoneCents, byReason, byClient };
}

/** Comp leakage as a share of gross billable value (charged + foregone).
 *  High leakage = the studio is giving away a meaningful slice of revenue. */
export function compLeakageShare(totalForegoneCents: number, chargedRevenueCents: number): number {
  const gross = chargedRevenueCents + totalForegoneCents;
  return gross > 0 ? totalForegoneCents / gross : 0;
}
