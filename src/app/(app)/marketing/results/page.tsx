"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TEMPLATES } from "@/components/social/template-picker";
import { computeRange, RANGE_OPTIONS, type RangeDays } from "./range";
import { summarizeResults } from "./summary";

const TEMPLATE_LABEL: Record<string, string> = Object.fromEntries(TEMPLATES.map((t) => [t.key, t.label]));

/** A range chip's full selection: which width is active plus the exact
 *  window it maps to. Kept as ONE state value (set in one `setState` call)
 *  rather than a separate `days` state and `to` state, so the two can never
 *  be observed out of step with each other - the window a chip shows is
 *  always the window `computeRange` derived for that same click, never a
 *  days value paired with a `to` left over from a different one. */
type Selection = { days: RangeDays; from: number; to: number };

function selectionFor(days: RangeDays): Selection {
  return { days, ...computeRange(Date.now(), days) };
}

/** Results: what each published post actually drove, per
 *  `marketing/results.perPost` - clicks, bookings attributed within 7 days
 *  of publish, revenue, and code redemptions, plus GHL impressions/
 *  engagements once the daily stats refresh has populated them. */
export default function ResultsPage() {
  // `selection` is a snapshot taken once at mount and re-taken only when a
  // range chip is clicked - never `Date.now()` read fresh on every render.
  // useQuery compares args by value, so a `to` that ticks forward every
  // render would hand it a "new" window on every single render and never
  // let one subscription settle long enough to deliver a result (posts.list
  // on the calendar page avoids this the same way, via monthBounds in a
  // useMemo keyed on year/month rather than the current instant).
  const [selection, setSelection] = React.useState<Selection>(() => selectionFor(30));
  const rows = useQuery(api.marketing.results.perPost, { from: selection.from, to: selection.to });
  const summary = React.useMemo(() => (rows ? summarizeResults(rows) : null), [rows]);

  function selectRange(days: RangeDays) {
    setSelection(selectionFor(days));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map((r) => (
          <Button
            key={r.days}
            type="button"
            variant={selection.days === r.days ? "secondary" : "outline"}
            size="sm"
            className={cn(selection.days === r.days && "border-gold")}
            onClick={() => selectRange(r.days)}
          >
            {r.label}
          </Button>
        ))}
      </div>

      {rows === undefined || !summary ? (
        <LoadingPanel label="Loading results" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No posts in this range"
          description={`No posts published in the last ${selection.days} days. Try a wider range, or publish a new post to start tracking it.`}
        />
      ) : (
        <>
          {(() => {
            // "Best in range" only means something with more than one post
            // to compare - a single post can't be said to have "won".
            const topRow = rows.length > 1 ? rows.find((r) => r.postId === summary.topPostId) : undefined;
            const topCaption = topRow?.caption.trim();
            return (
              <div className="rise-soft flex flex-col gap-3 rounded-chrome material-thin glass-edge border-transparent p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-bone">
                  <span className="font-grotesk font-semibold">{summary.totalClicks}</span> clicks,{" "}
                  <span className="font-grotesk font-semibold">{summary.totalBookings}</span>{" "}
                  {summary.totalBookings === 1 ? "booking" : "bookings"},{" "}
                  <span className="font-grotesk font-semibold">{money(summary.totalRevenueCents)}</span> revenue and{" "}
                  <span className="font-grotesk font-semibold">{summary.totalRedemptions}</span> code{" "}
                  {summary.totalRedemptions === 1 ? "redemption" : "redemptions"} across {summary.postCount}{" "}
                  {summary.postCount === 1 ? "post" : "posts"} in the last {selection.days} days.
                </p>
                {topRow ? (
                  <Badge tone="gold" className="w-fit max-w-full shrink-0 normal-case">
                    <span className="truncate">
                      Leading: {topCaption ? `"${topCaption.slice(0, 40)}${topCaption.length > 40 ? "..." : ""}"` : "(empty caption)"}
                    </span>
                  </Badge>
                ) : (
                  <Badge tone="neutral" className="w-fit shrink-0 normal-case">
                    No clicks or bookings yet this range
                  </Badge>
                )}
              </div>
            );
          })()}
          <Table>
            <THead>
              <TR>
                <TH>Post</TH>
                <TH className="text-right">Clicks</TH>
                <TH className="text-right">Bookings</TH>
                <TH className="text-right">Revenue</TH>
                <TH className="text-right">Code redemptions</TH>
                <TH className="text-right">
                  <Tooltip
                    label="GoHighLevel per-post stats"
                    hint="Syncs from your connected GHL accounts once available. Shows &quot;Not synced&quot; until then."
                  >
                    <span className="inline-flex cursor-help items-center gap-1">
                      GHL impressions
                      <Info className="size-3" />
                    </span>
                  </Tooltip>
                </TH>
                <TH className="text-right">
                  <Tooltip
                    label="GoHighLevel per-post stats"
                    hint="Syncs from your connected GHL accounts once available. Shows &quot;Not synced&quot; until then."
                  >
                    <span className="inline-flex cursor-help items-center gap-1">
                      GHL engagements
                      <Info className="size-3" />
                    </span>
                  </Tooltip>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const isTop = rows.length > 1 && r.postId === summary.topPostId;
                return (
                  <TR key={r.postId} className={cn(isTop && "bg-gold/[0.04]")}>
                    <TD className="max-w-80">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-bone">{r.caption.trim() || "(empty caption)"}</div>
                        {isTop && (
                          <Badge tone="gold" className="shrink-0">
                            Top
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-steel/70">
                        {TEMPLATE_LABEL[r.template] ?? r.template} - {shortDate(r.publishedAt)}
                      </div>
                    </TD>
                    <TD className="text-right">{r.clicks}</TD>
                    <TD className="text-right">{r.bookings}</TD>
                    <TD className="text-right">{money(r.revenueCents)}</TD>
                    <TD className="text-right">{r.redemptions}</TD>
                    <TD className="text-right text-steel/50">{r.stats?.impressions ?? "Not synced"}</TD>
                    <TD className="text-right text-steel/50">{r.stats?.engagements ?? "Not synced"}</TD>
                  </TR>
                );
              })}
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
