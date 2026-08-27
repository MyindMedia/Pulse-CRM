"use client";

import type { Doc, Id } from "@convex/_generated/dataModel";
import type { Platform } from "@convex/lib/ghl";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { PLATFORM_META } from "./platforms";
import { cn } from "@/lib/utils";

/** Status pill colours per the brief: draft is neutral, approved is info,
 *  scheduled is gold, published is positive, failed is critical.
 *  `posts.list` never returns a cancelled post (filtered server-side,
 *  convex/marketing/posts.ts:240), so cancelled has no entry here. */
export const POST_STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  draft: "neutral",
  approved: "info",
  scheduled: "gold",
  published: "positive",
  failed: "critical",
};

export const POST_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** A chip shows at most this many network marks before collapsing the rest
 *  into a "+N" count - a chip is ~7rem wide (calendar cell, page.tsx) and a
 *  fifth icon stops reading as identity and starts reading as texture. */
const MAX_CHIP_MARKS = 4;

/** Resolve the distinct platforms a post is going to, in account order, deduped
 *  so two accounts on the same network (e.g. two Instagram pages) draw one
 *  mark. Returns `[]` while `accounts` is still loading or for an accountId
 *  that no longer matches a connected account (removed since the post was
 *  made) - the chip falls back to the status pill alone rather than guessing. */
export function platformsForPost(
  accountIds: readonly Id<"socialAccounts">[],
  accounts: ReadonlyArray<{ _id: Id<"socialAccounts">; platform: Platform }> | undefined,
): Platform[] {
  if (!accounts) return [];
  const seen = new Set<Platform>();
  const ordered: Platform[] = [];
  for (const id of accountIds) {
    const account = accounts.find((a) => a._id === id);
    if (account && !seen.has(account.platform)) {
      seen.add(account.platform);
      ordered.push(account.platform);
    }
  }
  return ordered;
}

/** One post on the marketing calendar - a status pill, the network marks it
 *  is going out to, and a caption preview. Clicking opens the post detail
 *  sheet.
 *
 *  Buffer's calendar answers "where is this going" from the card alone, via
 *  a network icon plus dot; ours used to hide that behind a click into the
 *  sheet. `platforms` (resolved from `accountIds` against the org's account
 *  list) puts the same answer on the chip. */
export function PostChip({
  post,
  accounts,
  onClick,
}: {
  post: Pick<Doc<"socialPosts">, "caption" | "status" | "accountIds">;
  accounts: ReadonlyArray<{ _id: Id<"socialAccounts">; platform: Platform }> | undefined;
  onClick: () => void;
}) {
  const preview = post.caption.trim() || "(empty caption)";
  const shown = preview.length > 40 ? `${preview.slice(0, 40)}...` : preview;
  const platforms = platformsForPost(post.accountIds, accounts);
  const shownMarks = platforms.slice(0, MAX_CHIP_MARKS);
  const overflow = platforms.length - shownMarks.length;
  const destinationLabel = platforms.map((p) => PLATFORM_META[p].label).join(", ");

  return (
    <button
      type="button"
      onClick={onClick}
      title={destinationLabel || undefined}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-md border border-graphite/50 bg-coal-2 px-2 py-1.5 text-left",
        "transition-colors hover:border-gold-dim/60 hover:bg-coal-3/60",
      )}
    >
      <div className="flex w-full min-w-0 items-center gap-1">
        <Badge tone={POST_STATUS_TONE[post.status] ?? "neutral"} className="shrink-0 text-[0.5625rem]">
          {POST_STATUS_LABEL[post.status] ?? post.status}
        </Badge>
        {shownMarks.length > 0 && (
          <span
            className="flex min-w-0 shrink-0 items-center gap-0.5"
            aria-label={destinationLabel ? `Posting to ${destinationLabel}` : undefined}
          >
            {shownMarks.map((platform) => {
              const Icon = PLATFORM_META[platform].icon;
              return <Icon key={platform} className="size-3 shrink-0" aria-hidden="true" />;
            })}
            {overflow > 0 && (
              <span className="font-meta text-[0.5625rem] text-steel/70">+{overflow}</span>
            )}
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-xs leading-tight text-bone">{shown}</span>
    </button>
  );
}
