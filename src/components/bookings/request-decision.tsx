"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { AlertTriangle, Check, Clock, XClose } from "@untitledui/icons";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { money } from "@/lib/format";
import { useCapabilities } from "@/lib/use-capabilities";

/* Booking requests (orgs.bookingFeatures.requireApproval / hidePricing).
   A public booking that landed as a request holds its slot until an owner
   or manager approves or declines it. These pieces show that state on the
   booking sheet, the calendar sheet, the cards and the inbox. The server
   (convex/bookingRequests.ts) enforces who may decide; hiding the buttons
   for everyone else is only convenience. */

type RequestState = "pending" | "approved" | "declined" | null | undefined;

/** "Request" chip for a pending booking request. Renders nothing otherwise. */
export function RequestBadge({ requestStatus }: { requestStatus?: RequestState }) {
  if (requestStatus !== "pending") return null;
  return (
    <Badge tone="caution">
      <Clock className="size-2.5" />
      Request
    </Badge>
  );
}

/** Approve / Decline for one pending request. */
export function RequestDecision({
  sessionId,
  requestStatus,
  amountPaidCents,
  onDecided,
  compact,
}: {
  sessionId: Id<"sessions">;
  requestStatus?: RequestState;
  /** Paid so far. Declining does not refund it, so staff are warned. */
  amountPaidCents?: number;
  onDecided?: () => void;
  /** Inbox card layout: no heading copy. */
  compact?: boolean;
}) {
  const { can, loaded } = useCapabilities();
  const approve = useMutation(api.bookingRequests.approve);
  const decline = useMutation(api.bookingRequests.decline);
  const [busy, setBusy] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [reason, setReason] = React.useState("");

  if (requestStatus !== "pending") return null;
  const mayDecide = loaded && can("schedule.manage");
  const paid = amountPaidCents ?? 0;

  async function onApprove() {
    setBusy(true);
    try {
      const res = await approve({ sessionId });
      toast.success(
        res.depositDue
          ? "Approved. The client got the pay link; paying the deposit confirms it."
          : "Approved and confirmed. The client got an email and a text.",
      );
      onDecided?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function onDecline() {
    setBusy(true);
    try {
      const res = await decline({ sessionId, reason: reason.trim() || undefined });
      toast.success(
        res.refundNeededCents > 0
          ? `Declined. Refund the ${money(res.refundNeededCents)} payment by hand in Stripe.`
          : "Declined. The client got an email and a text.",
      );
      setDeclining(false);
      setReason("");
      onDecided?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not decline. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-caution/30 bg-caution/10 p-4">
      {!compact && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 font-grotesk text-sm font-semibold text-bone">
            <Clock className="size-4 text-caution" />
            Booking request
          </p>
          <p className="text-xs text-steel">
            {mayDecide
              ? "It's holding the slot. Approve to confirm it, or decline to free the time. The client gets an email and a text either way."
              : "It's holding the slot until an owner or manager approves or declines it."}
          </p>
        </div>
      )}

      {mayDecide && declining && (
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional note to the client, e.g. we're closed for a private event that day."
            rows={2}
            maxLength={500}
          />
          {paid > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-critical">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              The client paid {money(paid)}. Declining does not refund it: refund it by hand in Stripe.
            </p>
          )}
        </div>
      )}

      {mayDecide && (
        <div className="flex flex-wrap items-center gap-2">
          {declining ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void onDecline()}>
                <XClose className="size-3.5" /> Decline request
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeclining(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={() => void onApprove()}>
                <Check className="size-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
                <XClose className="size-3.5" /> Decline
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
