"use client";

import Link from "next/link";
import type { Id } from "@convex/_generated/dataModel";
import { MessagesSquare } from "lucide-react";
import { ChatThread, ChatComposer } from "@/components/messages/chat";

/** Per-client comms on the client page: the same conversation the Messages
 *  page shows, with replies by text and in the portal, and the composer. */
export function ClientMessages({ artistId }: { artistId: Id<"artists"> }) {
  return (
    <div className="space-y-2">
      <div className="flex h-[min(70dvh,40rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-graphite/50 bg-ink-2">
        <ChatThread artistId={artistId} className="flex-1" />
        <ChatComposer artistId={artistId} />
      </div>
      <Link href={`/messages?client=${artistId}`} className="inline-flex items-center gap-1.5 text-xs text-steel/70 hover:text-bone">
        <MessagesSquare className="size-3.5" /> Open in Messages
      </Link>
    </div>
  );
}
