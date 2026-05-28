"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, MessageSquare } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WaveformPlayer } from "./waveform-player";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** In-app audio review surface for one deliverable: waveform player +
 *  timestamped notes list. Mounting the dialog issues the gated download
 *  URL, so the audio + decoded waveform only load when actually opened. */
export function DeliverableReviewDialog({
  deliverableId,
  label,
  authorName,
  open,
  onOpenChange,
}: {
  deliverableId: Id<"deliverables">;
  label: string;
  authorName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const comments = useQuery(api.deliverables.comments, open ? { deliverableId } : "skip");
  const resolve = useMutation(api.deliverables.resolveComment);

  async function toggleResolved(id: Id<"revisionComments">, resolved: boolean) {
    try {
      await resolve({ id, resolved: !resolved });
    } catch {
      toast.error("Could not update the note.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{label} - review</DialogTitle>
          <DialogDescription>Play in-app, scrub the waveform, and drop timestamped notes the engineer can act on.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {open && <WaveformPlayer deliverableId={deliverableId} authorName={authorName} />}

          <div>
            <h3 className="overline">Notes</h3>
            {comments === undefined ? (
              <Skeleton className="mt-2 h-24 w-full" />
            ) : comments.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-hairline-2 py-6 text-center text-xs text-ash-dim">
                No notes yet. Double-click the waveform to drop one at that timestamp.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {comments.map((c) => (
                  <li
                    key={c._id}
                    className={`rounded-md border border-hairline bg-coal-2 p-3 ${c.resolved ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bone">
                        <MessageSquare className="size-3.5 text-ash-dim" />
                        <span className="font-mono text-[0.625rem] uppercase tracking-wide text-gold">
                          {fmtTime(c.timestampSec)}
                        </span>
                        {c.authorName}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => toggleResolved(c._id, c.resolved)}>
                        <Check className={`size-3.5 ${c.resolved ? "text-positive" : "text-ash-dim"}`} />
                        {c.resolved ? "Resolved" : "Mark resolved"}
                      </Button>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-bone">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
