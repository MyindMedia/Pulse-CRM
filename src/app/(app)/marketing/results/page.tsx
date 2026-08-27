"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TEMPLATES } from "@/components/social/template-picker";

const DAY = 86_400_000;
const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

const TEMPLATE_LABEL: Record<string, string> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.label]));

/** Results: what each published post actually drove, per
 *  `marketing/results.perPost` - clicks, bookings attributed within 7 days
 *  of publish, revenue, and code redemptions, plus GHL impressions/
 *  engagements once the daily stats refresh has populated them. */
export default function ResultsPage() {
  const [days, setDays] = React.useState<number>(30);
  // `to` is a snapshot taken once at mount and re-taken only when the range
  // chip changes - not `Date.now()` read fresh on every render. useQuery
  // compares args by value, so a `to` that ticks forward every render would
  // hand it a "new" window on every single render and never let one
  // subscription settle long enough to deliver a result (posts.list on the
  // calendar page avoids this the same way, via monthBounds in a useMemo
  // keyed on year/month rather than the current instant).
  const [to, setTo] = React.useState(() => Date.now());
  const from = to - days * DAY;
  const rows = useQuery(api.marketing.results.perPost, { from, to });

  function selectRange(d: number) {
    setDays(d);
    setTo(Date.now());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.days}
            type="button"
            variant={days === r.days ? "secondary" : "outline"}
            size="sm"
            className={cn(days === r.days && "border-gold")}
            onClick={() => selectRange(r.days)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {rows === undefined ? null : rows.length === 0 ? (
        <EmptyState
          title="No results yet"
          description="Publish a post with a booking link to see results here."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Post</TH>
                <TH className="text-right">Clicks</TH>
                <TH className="text-right">Bookings</TH>
                <TH className="text-right">Revenue</TH>
                <TH className="text-right">Code redemptions</TH>
                <TH className="text-right">GHL impressions</TH>
                <TH className="text-right">GHL engagements</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.postId}>
                  <TD className="max-w-80">
                    <div className="truncate text-bone">{r.caption.trim() || "(empty caption)"}</div>
                    <div className="text-xs text-steel/70">
                      {TEMPLATE_LABEL[r.template] ?? r.template} - {shortDate(r.publishedAt)}
                    </div>
                  </TD>
                  <TD className="text-right">{r.clicks}</TD>
                  <TD className="text-right">{r.bookings}</TD>
                  <TD className="text-right">{money(r.revenueCents)}</TD>
                  <TD className="text-right">{r.redemptions}</TD>
                  <TD className="text-right">{r.stats?.impressions ?? "-"}</TD>
                  <TD className="text-right">{r.stats?.engagements ?? "-"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-xs text-steel/70">
            A booking counts when it started from the post&apos;s link or used its code within 7 days of publishing.
          </p>
        </>
      )}
    </div>
  );
}
