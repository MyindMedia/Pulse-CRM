"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CheckCircle, ClockRefresh, XCircle } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/* Change approvals (bookingFeatures.changeApproval): a pending proposed
   change on this booking. The approver sees Approve / Decline; the person who
   asked sees who it is waiting on and can withdraw it. Renders nothing when
   there is no pending change, which is always the case with the switch off. */

export type PendingChange = FunctionReturnType<typeof api.sessionChanges.forSession>[number];

function errorText(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "data" in err && typeof (err as { data: unknown }).data === "string") {
    return (err as { data: string }).data;
  }
  return err instanceof Error ? err.message : fallback;
}

/** Approve / Decline (with an optional note) for one pending change. Shared
 *  by the booking banner and the "Changes waiting for you" card. */
export function ChangeDecisionButtons({ change }: { change: PendingChange }) {
  const approve = useMutation(api.sessionChanges.approve);
  const decline = useMutation(api.sessionChanges.decline);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  async function doApprove() {
    setBusy(true);
    try {
      const res = await approve({ requestId: change._id });
      toast.success("Change approved");
      if (res.staffingWarning) toast.warning(res.staffingWarning);
    } catch (err) {
      toast.error(errorText(err, "Could not approve the change"));
    } finally {
      setBusy(false);
    }
  }

  async function doDecline() {
    setBusy(true);
    try {
      await decline({ requestId: change._id, note: note.trim() || undefined });
      toast.success("Change declined");
      setDeclining(false);
      setNote("");
    } catch (err) {
      toast.error(errorText(err, "Could not decline the change"));
    } finally {
      setBusy(false);
    }
  }

  if (declining) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for them (optional)"
          className="h-8 min-w-0 flex-1 text-xs"
          aria-label="Note for the person who asked"
        />
        <Button size="sm" variant="danger" disabled={busy} onClick={doDecline}>
          Decline
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeclining(false)}>
          Back
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="primary" disabled={busy} onClick={doApprove}>
        <CheckCircle className="size-3.5" />
        Approve
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
        <XCircle className="size-3.5" />
        Decline
      </Button>
    </div>
  );
}

function ChangeRow({ change }: { change: PendingChange }) {
  const withdraw = useMutation(api.sessionChanges.withdraw);
  const [busy, setBusy] = useState(false);
  const fromGoogle = change.origin === "google";

  async function doWithdraw() {
    setBusy(true);
    try {
      await withdraw({ requestId: change._id });
      toast.success("Change withdrawn");
    } catch (err) {
      toast.error(errorText(err, "Could not withdraw the change"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-bone">{change.summary}</p>
      <p className="text-xs text-steel">
        {fromGoogle ? "Changed in Google Calendar" : `Asked by ${change.isMine ? "you" : change.requesterName}`}
        {change.reason ? `: "${change.reason}"` : ""}
      </p>
      {change.canDecide ? (
        <ChangeDecisionButtons change={change} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-steel">Waiting on {change.approverName}</span>
          {change.isMine && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={doWithdraw}>
              Withdraw
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function PendingChangeBanner({ sessionId }: { sessionId: Id<"sessions"> }) {
  const changes = useQuery(api.sessionChanges.forSession, { sessionId });
  if (!changes || changes.length === 0) return null;
  return (
    <div className="space-y-3 rounded-md border border-caution/40 bg-caution/[0.06] p-3" role="status">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-caution">
        <ClockRefresh className="size-3.5" />
        {changes.length === 1 ? "Change waiting for approval" : `${changes.length} changes waiting for approval`}
      </p>
      <div className="divide-y divide-hairline [&>*]:py-2 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
        {changes.map((c) => (
          <ChangeRow key={c._id} change={c} />
        ))}
      </div>
    </div>
  );
}
