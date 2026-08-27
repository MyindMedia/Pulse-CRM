"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarClock, CheckCircle2, FileEdit, TrendingUp } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { errorMessage } from "@/lib/errors";
import { useCapabilities } from "@/lib/use-capabilities";
import { longDate, timeOfDay } from "@/lib/format";
import { PLATFORM_META } from "@/components/social/platforms";
import { PostChip, POST_STATUS_LABEL, POST_STATUS_TONE } from "@/components/social/post-chip";
import { monthBounds, monthGrid, dayKeyFor } from "@/components/social/calendar-math";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MarketingCalendarPage() {
  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth());
  const [selectedId, setSelectedId] = React.useState<Id<"socialPosts"> | null>(null);

  const { from, to } = React.useMemo(() => monthBounds(year, month), [year, month]);
  const posts = useQuery(api.marketing.posts.list, { from, to });
  const results = useQuery(api.marketing.results.perPost, { from, to });
  const accounts = useQuery(api.marketing.accounts.list, {});

  function goPrevMonth() {
    setSelectedId(null);
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function goNextMonth() {
    setSelectedId(null);
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }
  function goToday() {
    setSelectedId(null);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  const weeks = React.useMemo(() => monthGrid(year, month), [year, month]);
  const postsByDay = React.useMemo(() => {
    const map = new Map<string, Doc<"socialPosts">[]>();
    for (const p of posts ?? []) {
      const key = dayKeyFor(p.scheduledFor);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [posts]);

  const scheduledCount = posts?.filter((p) => p.status === "scheduled").length ?? 0;
  const publishedCount = posts?.filter((p) => p.status === "published").length ?? 0;
  const draftCount = posts?.filter((p) => p.status === "draft").length ?? 0;
  const bookingsCount = results?.reduce((sum, r) => sum + r.bookings, 0) ?? 0;

  const selectedPost = posts?.find((p) => p._id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Scheduled this month" value={posts === undefined ? "-" : scheduledCount} icon={CalendarClock} />
        <StatTile label="Published this month" value={posts === undefined ? "-" : publishedCount} icon={CheckCircle2} />
        <StatTile label="Drafts awaiting approval" value={posts === undefined ? "-" : draftCount} icon={FileEdit} />
        <StatTile label="Bookings from posts" value={results === undefined ? "-" : bookingsCount} icon={TrendingUp} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-grotesk text-lg font-semibold text-bone">
          {new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" onClick={goPrevMonth} aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={goNextMonth} aria-label="Next month">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[42rem] grid-cols-7 gap-px rounded-xl border border-graphite/50 bg-graphite/50 shadow-elev-1">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="material-ultrathin px-2 py-1.5 text-center font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
              {w}
            </div>
          ))}
          {weeks.map((week, wi) =>
            week.map((cell) => {
              const dayPosts = postsByDay.get(dayKeyFor(cell.ts)) ?? [];
              return (
                <div
                  key={`${wi}-${cell.ts}`}
                  className={cn(
                    "min-h-28 space-y-1 bg-coal p-1.5",
                    !cell.inMonth && "bg-coal/40 opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-5 items-center justify-center rounded-full text-xs",
                      cell.isToday ? "bg-gold font-semibold text-gold-ink" : "text-steel/70",
                    )}
                  >
                    {cell.day}
                  </span>
                  <div className="space-y-1">
                    {dayPosts.map((p) => (
                      <PostChip key={p._id} post={p} onClick={() => setSelectedId(p._id)} />
                    ))}
                  </div>
                </div>
              );
            }),
          )}
        </div>
      </div>

      <PostSheet
        post={selectedPost}
        accounts={accounts}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

function PostSheet({
  post,
  accounts,
  onClose,
}: {
  post: Doc<"socialPosts"> | null;
  accounts: Array<Pick<Doc<"socialAccounts">, "_id" | "platform" | "name">> | undefined;
  onClose: () => void;
}) {
  const { can, loaded } = useCapabilities();
  const canEdit = can("marketing.edit");
  const canApprove = can("marketing.approve");
  const approve = useMutation(api.marketing.posts.approve);
  const cancel = useMutation(api.marketing.posts.cancel);
  const [busy, setBusy] = React.useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "That did not go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const open = post !== null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="md">
        {post && (
          <>
            <SheetHeader>
              <Badge tone={POST_STATUS_TONE[post.status] ?? "neutral"}>
                {POST_STATUS_LABEL[post.status] ?? post.status}
              </Badge>
              <SheetTitle>{post.caption.slice(0, 60) || "(empty caption)"}</SheetTitle>
              <SheetDescription>
                {longDate(post.scheduledFor)} at {timeOfDay(post.scheduledFor)} ({post.timezone})
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-5">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-steel">Caption</p>
                <p className="whitespace-pre-wrap rounded-md border border-graphite/50 bg-coal-2 p-3 text-sm text-bone">
                  {post.caption}
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-steel">Accounts</p>
                {accounts === undefined ? (
                  <p className="text-sm text-steel/70">Loading...</p>
                ) : post.accountIds.length === 0 ? (
                  <p className="text-sm text-steel/70">No account picked yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {post.accountIds.map((id) => {
                      const a = accounts.find((x) => x._id === id);
                      if (!a) return (
                        <li key={id} className="text-sm text-steel/70">
                          An account no longer connected
                        </li>
                      );
                      const meta = PLATFORM_META[a.platform];
                      return (
                        <li key={id} className="flex items-center gap-2 text-sm text-bone">
                          <meta.icon className="size-3.5 text-steel/70" />
                          {a.name}
                          <span className="text-xs text-steel/70">{meta.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {post.link && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-steel">Link</p>
                  <a
                    href={post.link}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 font-meta text-xs text-gold underline"
                  >
                    {post.link}
                  </a>
                </div>
              )}

              {post.status === "failed" && post.failure && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-steel">Why it failed</p>
                  <p className="rounded-md border border-critical/30 bg-critical/10 p-3 text-sm text-critical">
                    {post.failure}
                  </p>
                </div>
              )}
            </SheetBody>
            <SheetFooter className="flex-wrap">
              {canEdit && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/marketing/compose?post=${post._id}`}>Edit</Link>
                </Button>
              )}
              {canApprove && post.status === "draft" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => approve({ id: post._id }), "Approved and scheduled.")}
                >
                  Approve
                </Button>
              )}
              {canApprove && post.status === "failed" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => approve({ id: post._id }), "Retrying...")}
                >
                  Retry
                </Button>
              )}
              {canApprove && post.status !== "published" && (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => cancel({ id: post._id }), "Post cancelled.")}
                >
                  Cancel
                </Button>
              )}
              {!canEdit && !canApprove && loaded && (
                <p className="text-xs text-steel/70">
                  Ask a studio owner or manager to edit, approve, cancel, or retry this post.
                </p>
              )}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
