"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Sparkles, FileText, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { AiDraftCard, NoArtifactsYet } from "./draft-card";

/** Per-session AI artifacts (recap / prep packet / reminders). Slots into
 * the SessionSheet under the engineering log. */
export function SessionAiPanel({ sessionId }: { sessionId: Id<"sessions"> }) {
  const artifacts = useQuery(api.aiArtifacts.forSession, { sessionId });
  const generateRecap = useAction(api.aiActions.generateSessionRecap);
  const generatePrep = useAction(api.aiActions.generatePrepPacket);
  const [recapPending, setRecapPending] = React.useState(false);
  const [prepPending, setPrepPending] = React.useState(false);

  async function runRecap() {
    setRecapPending(true);
    try {
      await generateRecap({ sessionId });
      toast.success("Recap generated.");
    } catch (err) {
      toast.error(errorMessage(err, "Recap failed."));
    } finally {
      setRecapPending(false);
    }
  }
  async function runPrep() {
    setPrepPending(true);
    try {
      await generatePrep({ sessionId });
      toast.success("Prep packet generated.");
    } catch (err) {
      toast.error(errorMessage(err, "Prep packet failed."));
    } finally {
      setPrepPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-ash">
          <Sparkles className="size-3.5 text-gold" />
          Pulse AI
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={runPrep} disabled={prepPending}>
            <FileText className="size-3.5" /> Generate prep
          </Button>
          <Button variant="ghost" size="sm" onClick={runRecap} disabled={recapPending}>
            <Mail className="size-3.5" /> Generate recap
          </Button>
        </div>
      </div>
      {artifacts === undefined ? (
        <div className="skeleton h-20 rounded-md" />
      ) : artifacts.length === 0 ? (
        <NoArtifactsYet message="No AI artifacts yet for this session." />
      ) : (
        <div className="space-y-2">
          {artifacts.map((a) => (
            <AiDraftCard key={a._id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}
