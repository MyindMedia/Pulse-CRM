"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Gift, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import { money } from "@/lib/format";

/**
 * Comp control for one booking. Comping bills nothing but captures the value
 * the session would have charged (`compedValueCents`) so the owner can see the
 * revenue given away - it rolls up into the Comped revenue-loss report and the
 * AI agent's reporting. Shared by the Bookings drawer and the calendar sheet.
 */
export function CompPanel({
  sessionId,
  comped,
  compedValueCents,
  compReason,
  rateCents,
  cancelled,
}: {
  sessionId: Id<"sessions">;
  comped?: boolean;
  compedValueCents?: number;
  compReason?: string;
  rateCents: number;
  cancelled?: boolean;
}) {
  const setComp = useMutation(api.sessions.setComp);
  const [busy, setBusy] = React.useState(false);
  const [reason, setReason] = React.useState("");

  async function comp() {
    if (busy) return;
    setBusy(true);
    try {
      await setComp({ id: sessionId, comped: true, reason: reason.trim() || undefined });
      toast.success("Session comped - revenue loss captured in reporting");
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not comp the session");
    } finally {
      setBusy(false);
    }
  }

  async function uncomp() {
    if (busy) return;
    setBusy(true);
    try {
      await setComp({ id: sessionId, comped: false });
      toast.success("Comp removed - the session is billable again");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the comp");
    } finally {
      setBusy(false);
    }
  }

  if (comped) {
    return (
      <div className="space-y-2 rounded-md border border-gold/30 bg-gold/5 p-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold-bright">
            <Gift className="size-3.5" />
            Comped session
          </span>
          <Badge tone="gold">No charge</Badge>
        </div>
        <p className="text-xs text-steel">
          This session was waived. The studio is giving away{" "}
          <span className="font-meta font-semibold text-gold-bright">
            {money(compedValueCents ?? 0)}
          </span>{" "}
          in revenue - it&apos;s tracked as a loss in the Comped report.
        </p>
        {compReason && (
          <p className="text-[0.6875rem] text-steel/70">Reason: {compReason}</p>
        )}
        {!cancelled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={uncomp}>
            {busy ? <Spinner /> : <Undo2 className="size-3.5" />}
            Remove comp
          </Button>
        )}
      </div>
    );
  }

  if (cancelled) return null;

  return (
    <div className="space-y-2 rounded-md border border-dashed border-graphite/60 p-3">
      <p className="overline">Comp this session</p>
      <p className="text-[0.6875rem] text-steel/70">
        Waive the charge but still capture the {money(rateCents)} as revenue loss,
        so owners see what comped sessions cost.
      </p>
      <Field label="Reason" hint="Optional - e.g. label comp, owner comp.">
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Label comp"
        />
      </Field>
      <Button variant="outline" size="sm" disabled={busy} onClick={comp}>
        {busy ? <Spinner /> : <Gift className="size-3.5" />}
        Comp · waive {money(rateCents)}
      </Button>
    </div>
  );
}
