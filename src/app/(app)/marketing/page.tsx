"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  FileEdit,
  TrendingUp,
  LayoutGrid,
  List,
  Plus,
  X,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
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
import { PostChip, POST_STATUS_LABEL, POST_STATUS_TONE, platformsForPost } from "@/components/social/post-chip";
import { monthBounds, monthGrid, dayKeyFor } from "@/components/social/calendar-math";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A studio's four stat tiles double as Buffer-style filters: clicking one
 *  narrows the visible posts to that bucket, clicking it again clears it.
 *  "bookings" means "the published posts that drove at least one booking
 *  this month" - the same set the tile's number is summed from. */
type StatFilter = "scheduled" | "published" | "draft" | "bookings";

const FILTER_EMPTY_TITLE: Record<StatFilter, string> = {
  scheduled: "No scheduled posts this month",
  published: "No published posts this month",
  draft: "No drafts awaiting approval this month",
  bookings: "No posts with bookings this month",
};

const FILTER_BANNER_LABEL: Record<StatFilter, string> = {
  scheduled: "Scheduled",
  published: "Published",
  draft: "Drafts awaiting approval",
  bookings: "Posts with bookings",
};

type ViewMode = "grid" | "list";

const VIEW_TOGGLE_BTN =
  "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30";

export default function MarketingCalendarPage() {
  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth());
  const [selectedId, setSelectedId] = React.useState<Id<"socialPosts"> | null>(null);
  const [view, setView] = React.useState<ViewMode>("grid");
  const [filter, setFilter] = React.useState<StatFilter | null>(null);

  const { can } = useCapabilities();
  const canEdit = can("marketing.edit");

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
  function toggleFilter(next: StatFilter) {
    setFilter((f) => (f === next ? null : next));
  }

  const weeks = React.useMemo(() => monthGrid(year, month), [year, month]);
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const scheduledCount = posts?.filter((p) => p.status === "scheduled").length ?? 0;
  const publishedCount = posts?.filter((p) => p.status === "published").length ?? 0;
  const draftCount = posts?.filter((p) => p.status === "draft").length ?? 0;
  const bookingsCount = results?.reduce((sum, r) => sum + r.bookings, 0) ?? 0;

  // Posts this month with at least one attributed booking - the set the
  // "Bookings from posts" tile filters to when clicked.
  const bookingPostIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of results ?? []) if (r.bookings > 0) set.add(r.postId as string);
    return set;
  }, [results]);

  // Tile counts above always describe the whole month, unfiltered; this is
  // the subset the grid/list actually render once a tile is active.
  const filteredPosts = React.useMemo(() => {
    const all = posts ?? [];
    if (filter === null) return all;
    if (filter === "bookings") return all.filter((p) => bookingPostIds.has(p._id));
    return all.filter((p) => p.status === filter);
  }, [posts, filter, bookingPostIds]);

  const postsByDay = React.useMemo(() => {
    const map = new Map<string, Doc<"socialPosts">[]>();
    for (const p of filteredPosts) {
      const key = dayKeyFor(p.scheduledFor);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [filteredPosts]);

  const loaded = posts !== undefined;
  const nothingToShow = loaded && filteredPosts.length === 0;

  const selectedPost = posts?.find((p) => p._id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Scheduled this month"
          value={posts === undefined ? "-" : scheduledCount}
          icon={CalendarClock}
          onClick={() => toggleFilter("scheduled")}
          accent={filter === "scheduled"}
        />
        <StatTile
          label="Published this month"
          value={posts === undefined ? "-" : publishedCount}
          icon={CheckCircle2}
          onClick={() => toggleFilter("published")}
          accent={filter === "published"}
        />
        <StatTile
          label="Drafts awaiting approval"
          value={posts === undefined ? "-" : draftCount}
          icon={FileEdit}
          onClick={() => toggleFilter("draft")}
          accent={filter === "draft"}
        />
        <StatTile
          label="Bookings from posts"
          value={results === undefined ? "-" : bookingsCount}
          icon={TrendingUp}
          onClick={() => toggleFilter("bookings")}
          accent={filter === "bookings"}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-grotesk text-lg font-semibold text-bone">{monthLabel}</h2>
        <div className="flex flex-wrap items-center gap-2">
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
          <div className="inline-flex items-center gap-1 rounded-md border border-graphite/50 bg-coal p-1">
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
              className={cn(VIEW_TOGGLE_BTN, view === "grid" ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone")}
            >
              <LayoutGrid className="size-3.5" />
              Grid
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={cn(VIEW_TOGGLE_BTN, view === "list" ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone")}
            >
              <List className="size-3.5" />
              List
            </button>
          </div>
        </div>
      </div>

      {filter !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-gold-dim/40 bg-gold/5 px-3 py-1.5 text-xs text-bone">
          <span>Showing: {FILTER_BANNER_LABEL[filter]}</span>
          <button
            type="button"
            onClick={() => setFilter(null)}
            className="inline-flex items-center gap-1 font-medium text-gold outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
          >
            <X className="size-3" />
            Clear filter
          </button>
        </div>
      )}

      {nothingToShow ? (
        <EmptyState
          icon={CalendarRange}
          title={filter ? FILTER_EMPTY_TITLE[filter] : `Nothing scheduled for ${monthLabel}`}
          description={
            filter
              ? "Clear the filter to see every post scheduled this month."
              : canEdit
                ? "Plan a post for this month so the calendar has something to show."
                : "Ask a studio manager to schedule a post for this month."
          }
          action={
            filter ? (
              <Button variant="outline" size="sm" onClick={() => setFilter(null)}>
                <X className="size-4" />
                Clear filter
              </Button>
            ) : canEdit ? (
              <Button asChild size="sm">
                <Link href="/marketing/compose">
                  <Plus className="size-4" />
                  New post
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : view === "grid" ? (
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
                        <PostChip key={p._id} post={p} accounts={accounts} onClick={() => setSelectedId(p._id)} />
                      ))}
                    </div>
                  </div>
                );
              }),
            )}
          </div>
        </div>
      ) : (
        <PostAgendaList posts={filteredPosts} accounts={accounts} onOpenPost={setSelectedId} />
      )}

      <PostSheet
        post={selectedPost}
        accounts={accounts}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

/** List density for a sparsely-posting studio: every visible post as one
 *  row, grouped by day, ascending. Where the grid dedicates a whole cell to
 *  even the emptiest day, a studio posting twice a week just gets two rows -
 *  the same information at the density that actually matches its volume.
 *  Shares the grid's `filteredPosts` and the same status/network vocabulary,
 *  so the two views never disagree and a stat-tile filter narrows both. */
function PostAgendaList({
  posts,
  accounts,
  onOpenPost,
}: {
  posts: Doc<"socialPosts">[];
  accounts: Array<Pick<Doc<"socialAccounts">, "_id" | "platform">> | undefined;
  onOpenPost: (id: Id<"socialPosts">) => void;
}) {
  const groups = new Map<string, Doc<"socialPosts">[]>();
  for (const p of [...posts].sort((a, b) => a.scheduledFor - b.scheduledFor)) {
    const key = dayKeyFor(p.scheduledFor);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }

  return (
    <div className="space-y-5">
      {[...groups.values()].map((dayPosts) => {
        const first = dayPosts[0];
        return (
          <section key={dayKeyFor(first.scheduledFor)} className="space-y-2">
            <h3 className="overline">{longDate(first.scheduledFor)}</h3>
            <div className="overflow-hidden rounded-lg border border-graphite/50 bg-coal">
              <ul className="divide-y divide-hairline">
                {dayPosts.map((p) => {
                  const platforms = platformsForPost(p.accountIds, accounts);
                  const preview = p.caption.trim() || "(empty caption)";
                  return (
                    <li key={p._id}>
                      <button
                        type="button"
                        onClick={() => onOpenPost(p._id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
                      >
                        <div className="w-16 shrink-0 pt-0.5">
                          <p className="font-meta text-xs font-medium text-bone">{timeOfDay(p.scheduledFor)}</p>
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm text-bone">{preview}</p>
                            <Badge tone={POST_STATUS_TONE[p.status] ?? "neutral"} className="shrink-0">
                              {POST_STATUS_LABEL[p.status] ?? p.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-steel/70">
                            {platforms.map((platform) => {
                              const Icon = PLATFORM_META[platform].icon;
                              return <Icon key={platform} className="size-3.5 shrink-0" aria-hidden="true" />;
                            })}
                            {platforms.length > 0 && (
                              <span>{platforms.map((platform) => PLATFORM_META[platform].label).join(", ")}</span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
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
