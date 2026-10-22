/* ============================================================
   Royalty Share maths. Integer cents only, no floats in the result.
   Spec: shares sum exactly to the line amount, and any rounding
   remainder goes to the largest share.
   ============================================================ */

export type SharePart = { key: string; pct: number };

/**
 * Split `amountCents` by percentage. Each share is the exact amount
 * truncated toward zero; the leftover cents (fewer than the number of
 * contributors) go to the contributor with the largest percentage, the
 * first one listed on a tie. Percentages are normalised by their total,
 * so a sheet that sums to 99.99 still allocates every cent. Negative
 * amounts (refunds, chargebacks) split the same way.
 */
export function allocate(amountCents: number, parts: SharePart[]): number[] {
  if (!Number.isInteger(amountCents)) throw new Error("amountCents must be an integer");
  const total = parts.reduce((s, p) => s + (p.pct > 0 ? p.pct : 0), 0);
  if (parts.length === 0 || total <= 0) return parts.map(() => 0);
  // Percentages carry up to two decimals: work in basis points of a percent.
  const weights = parts.map((p) => (p.pct > 0 ? Math.round(p.pct * 100) : 0));
  const weightTotal = weights.reduce((s, w) => s + w, 0);
  const shares = weights.map((w) => {
    const exact = (amountCents * w) / weightTotal;
    return exact < 0 ? Math.ceil(exact) : Math.floor(exact);
  });
  const remainder = amountCents - shares.reduce((s, c) => s + c, 0);
  let largest = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] > weights[largest]) largest = i;
  shares[largest] += remainder;
  return shares;
}

/** The parties on a fully executed sheet who take master income. */
export function masterParts<T extends { name: string; email?: string; masterPct: number }>(
  contributors: T[],
): { key: string; name: string; pct: number }[] {
  return contributors
    .filter((c) => c.masterPct > 0)
    .map((c) => ({
      key: contributorKey(c),
      name: c.name,
      pct: c.masterPct,
    }));
}

/** Who a share belongs to across statements: their email, else their name. */
export function contributorKey(c: { name: string; email?: string }): string {
  const email = c.email?.trim().toLowerCase();
  return email ? email : `name:${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`;
}
