"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useCapabilities } from "@/lib/use-capabilities";

/**
 * Jump from a studio room straight to its patch canvas, creating the space
 * on first click. Nobody should have to know that a "patch space" is a
 * separate object before they can draw the first cable in a room.
 */
export function OpenPatchButton({
  roomId,
  roomName,
  size = "sm",
  variant = "outline",
  className,
}: {
  roomId: Id<"rooms">;
  roomName: string;
  size?: "sm" | "md";
  variant?: "outline" | "secondary" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const openForRoom = useMutation(api.patchManager.openForRoom);
  const existing = useQuery(api.patchManager.spaceIdForRoom, { roomId }) as
    | { _id: Id<"patchSpaces">; deviceCount: number; connectionCount: number }
    | null
    | undefined;
  const { can, loaded } = useCapabilities();
  const [pending, setPending] = React.useState(false);

  if (loaded && !can("patch.read")) return null;

  const started = !!existing;

  async function open(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (existing) {
      router.push(`/patch/${existing._id}`);
      return;
    }
    if (!can("patch.edit")) {
      toast.error("No patch map for this room yet, and your role cannot start one.");
      return;
    }
    setPending(true);
    try {
      const id = await openForRoom({ roomId });
      router.push(`/patch/${id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the patch map.");
      setPending(false);
    }
  }

  return (
    <Tooltip
      label={started ? `Patch map for ${roomName}` : `Start a patch map for ${roomName}`}
      hint={
        started
          ? `${existing.deviceCount} device${existing.deviceCount === 1 ? "" : "s"}, ${existing.connectionCount} cable run${existing.connectionCount === 1 ? "" : "s"}. Opens the canvas.`
          : "Draw what is plugged into what in this room, using the gear installed here."
      }
    >
      <Button
        variant={variant}
        size={size}
        onClick={open}
        disabled={pending}
        aria-label={started ? `Open the patch map for ${roomName}` : `Start a patch map for ${roomName}`}
        className={cn(className)}
      >
        <Plug className="size-4" />
        {pending ? "Opening" : "Patch"}
        {started && existing.connectionCount > 0 && (
          <span className="rounded-[4px] bg-gold/15 px-1 font-meta text-[10px] font-semibold text-gold-bright">
            {existing.connectionCount}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
