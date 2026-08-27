/** Pure roll-up of `marketing/results.perPost` rows into the lead summary
 *  shown above the table - totals for the selected range, plus which post
 *  led it. Kept out of the component so the "what counts as best" rule is
 *  one readable, testable function instead of buried in JSX. */

export type ResultRow = {
  postId: string;
  clicks: number;
  bookings: number;
  revenueCents: number;
  redemptions: number;
};

export type ResultsSummary = {
  postCount: number;
  totalClicks: number;
  totalBookings: number;
  totalRevenueCents: number;
  totalRedemptions: number;
  /** The post that drove the most attributed activity this range, or `null`
   *  when nothing has happened yet (every row scores zero) - there is no
   *  "best" of a field of zeroes. */
  topPostId: string | null;
};

/** A post's activity score for ranking "best in range". Clicks, bookings and
 *  redemptions are summed unweighted: each is a real, distinct signal the
 *  attribution footer already explains, and a studio posting a handful of
 *  times a month does not have enough volume for a fancier weighting to mean
 *  anything. Revenue is deliberately not part of the score - two bookings at
 *  different room rates would otherwise change "best" for reasons a studio
 *  owner can't see on this row, and clicks/bookings/redemptions already move
 *  together with it. */
function score(row: ResultRow): number {
  return row.clicks + row.bookings + row.redemptions;
}

export function summarizeResults(rows: readonly ResultRow[]): ResultsSummary {
  const totals = rows.reduce(
    (acc, r) => ({
      totalClicks: acc.totalClicks + r.clicks,
      totalBookings: acc.totalBookings + r.bookings,
      totalRevenueCents: acc.totalRevenueCents + r.revenueCents,
      totalRedemptions: acc.totalRedemptions + r.redemptions,
    }),
    { totalClicks: 0, totalBookings: 0, totalRevenueCents: 0, totalRedemptions: 0 },
  );

  let topPostId: string | null = null;
  let topScore = 0;
  for (const row of rows) {
    const s = score(row);
    if (s > topScore) {
      topScore = s;
      topPostId = row.postId;
    }
  }

  return { postCount: rows.length, ...totals, topPostId };
}
