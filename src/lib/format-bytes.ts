/* File sizes as the team and the client read them. Decimal units and three
   significant figures, the same rules (and the same text) as the delivery
   email's formatBytes in convex/lib/emailTemplates/sessionDelivery.ts, so the
   panel, the queue, the client page and the email agree on every size. */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 212_000 -> "212 KB", 58_200_000 -> "58.2 MB", 1_420_000_000 -> "1.42 GB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  let i = 0;
  let v = n;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  let r = Number(v.toPrecision(3));
  // 999,999 bytes rounds to "1000 KB"; say 1 MB instead.
  if (r >= 1000 && i < UNITS.length - 1) {
    i++;
    r = Number((v / 1000).toPrecision(3));
  }
  return `${i === 0 ? Math.round(n) : r} ${UNITS[i]}`;
}
