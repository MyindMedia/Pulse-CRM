"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { meta, SYNC_STAGE } from "@/lib/labels";
import { relativeTime } from "@/lib/format";
import { SYNC_STAGE_ORDER, type SyncOpportunity, type SyncStage } from "./types";

/** Drill-down for a sync placement: edit deal details + restage. */
export function SyncSheet({ opp, onClose }: { opp: SyncOpportunity | null; onClose: () => void }) {
  return (
    <Sheet open={!!opp} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="md">
        {opp && <Inner key={opp._id} opp={opp} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function Inner({ opp, onClose }: { opp: SyncOpportunity; onClose: () => void }) {
  const update = useMutation(api.licensing.updateSync);
  const moveStage = useMutation(api.licensing.moveSyncStage);

  const [supervisorName, setSupervisor] = useState(opp.supervisorName);
  const [outlet, setOutlet] = useState(opp.outlet);
  const [fee, setFee] = useState(opp.feeCents !== undefined ? String(opp.feeCents / 100) : "");
  const [notes, setNotes] = useState(opp.notes ?? "");
  const [stage, setStage] = useState<SyncStage>(opp.stage);
  const [busy, setBusy] = useState(false);

  const m = meta(SYNC_STAGE, opp.stage);

  async function save() {
    setBusy(true);
    try {
      const cents = fee.trim() ? Math.round(parseFloat(fee) * 100) : undefined;
      await update({
        id: opp._id,
        supervisorName: supervisorName.trim(),
        outlet: outlet.trim(),
        feeCents: typeof cents === "number" && Number.isFinite(cents) ? cents : undefined,
        notes: notes.trim(),
      });
      if (stage !== opp.stage) await moveStage({ id: opp._id, stage });
      toast.success("Placement updated.");
      onClose();
    } catch {
      toast.error("Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <SheetTitle className="truncate">{opp.songTitle}</SheetTitle>
          <Badge tone={m.tone}>{m.label}</Badge>
        </div>
        <SheetDescription>Sync placement · updated {relativeTime(opp.updatedAt)}</SheetDescription>
      </SheetHeader>

      <SheetBody className="space-y-4">
        <Field label="Stage" htmlFor="sync-stage">
          <Select value={stage} onValueChange={(v) => setStage(v as SyncStage)}>
            <SelectTrigger id="sync-stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SYNC_STAGE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{meta(SYNC_STAGE, s).label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Music supervisor" htmlFor="sync-sup">
          <Input id="sync-sup" value={supervisorName} onChange={(e) => setSupervisor(e.target.value)} />
        </Field>

        <Field label="Outlet" htmlFor="sync-outlet" hint="Film, TV, ad, game, trailer…">
          <Input id="sync-outlet" value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="National ad - automotive" />
        </Field>

        <Field label="Fee ($)" htmlFor="sync-fee">
          <Input id="sync-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="2500" />
        </Field>

        <Field label="Notes" htmlFor="sync-notes" hint="Pitch context, contacts, next steps.">
          <Textarea id="sync-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Supervisor loved the hook; needs an instrumental by Friday." />
        </Field>
      </SheetBody>

      <SheetFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !supervisorName.trim() || !outlet.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save changes
        </Button>
      </SheetFooter>
    </>
  );
}
