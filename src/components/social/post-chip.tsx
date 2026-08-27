"use client";

import type { Doc } from "@convex/_generated/dataModel";
import { Badge, type BadgeProps } from "@/components/ui/badge";
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

/** One post on the marketing calendar - a caption preview and a status
 *  pill. Clicking opens the post detail sheet. */
export function PostChip({
  post,
  onClick,
}: {
  post: Pick<Doc<"socialPosts">, "caption" | "status">;
  onClick: () => void;
}) {
  const preview = post.caption.trim() || "(empty caption)";
  const shown = preview.length > 40 ? `${preview.slice(0, 40)}...` : preview;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col items-start gap-1 rounded-md border border-graphite/50 bg-coal-2 px-2 py-1.5 text-left",
        "transition-colors hover:border-gold-dim/60 hover:bg-coal-3/60",
      )}
    >
      <Badge tone={POST_STATUS_TONE[post.status] ?? "neutral"} className="text-[0.5625rem]">
        {POST_STATUS_LABEL[post.status] ?? post.status}
      </Badge>
      <span className="line-clamp-2 text-xs leading-tight text-bone">{shown}</span>
    </button>
  );
}
