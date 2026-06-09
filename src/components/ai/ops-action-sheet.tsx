"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, X, Clock, Mail, CalendarCheck, Sparkles, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";

const DAY = 86_400_000;
const PRIORITY_TONE: Record<string, "critical" | "gold" | "neutral"> = { high: "critical", medium: "gold", low: "neutral" };

/** Centered modal: drill-in detail + edit for one Ops Autopilot action. */
export function OpsActionSheet({ action, onClose }: { action: Doc<"opsActions"> | null; onClose: () => void }) {
  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        {action && <Inner key={action._id} action={action} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Inner({ action, onClose }: { action: Doc<"opsActions">; onClose: () => void }) {
  const approve = useMutation(api.opsActions.approve);
  const dismiss = useMutation(api.opsActions.dismiss);
  const snooze = useMutation(api.opsActions.snooze);
  const updateArtifact = useMutation(api.aiArtifacts.updateBody);
  const artifact = useQuery(api.aiArtifacts.get, action.artifactId ? { id: action.artifactId } : "skip");

  const p = action.payload;
  const isEmail = p.kind === "email";
  const [to] = React.useState(isEmail ? (p.to ?? "") : "");
  const [subject] = React.useState(isEmail ? (p.subject ?? "") : "");
  const [body, setBody] = React.useState(isEmail ? (p.body ?? "") : "");
  const [artBody, setArtBody] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const artText = artBody ?? artifact?.body ?? "";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); onClose(); }
    catch { toast.error("Action failed."); }
    finally { setBusy(false); }
  }

  async function doApprove() {
    setBusy(true);
    try {
      if (action.artifactId && artBody !== null && artBody.trim() !== (artifact?.body ?? "").trim()) {
        await updateArtifact({ id: action.artifactId, body: artBody.trim() });
      }
      const editedBody = isEmail && body.trim() !== (p.kind === "email" ? p.body ?? "" : "").trim() ? body.trim() : undefined;
      await approve(editedBody ? { id: action._id, editedBody } : { id: action._id });
      toast.success("Approved + executed.");
      onClose();
    } catch {
      toast.error("Could not approve.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2 pr-8">
          <DialogTitle className="truncate">{action.title}</DialogTitle>
          <Badge tone={PRIORITY_TONE[action.priority] ?? "neutral"}>{action.priority}</Badge>
        </div>
        <DialogDescription>{action.type.replace(/_/g, " ")}</DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel/70">Why the autopilot suggests this</p>
          <p className="mt-1 text-sm text-steel">{action.rationale}</p>
        </div>

        {isEmail && (
          <>
            <Field label="To"><Input value={to} disabled className="inline-flex items-center" /></Field>
            <Field label="Subject"><Input value={subject} disabled /></Field>
            <Field label="Message" htmlFor="ops-body" hint="Edit before you approve - your version is what sends.">
              <Textarea id="ops-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </>
        )}

        {action.artifactId && (
          <Field label="Draft" hint="Edit the prepared draft before approving.">
            {artifact === undefined ? (
              <div className="skeleton h-32 w-full rounded-md" />
            ) : (
              <Textarea rows={10} value={artText} onChange={(e) => setArtBody(e.target.value)} />
            )}
          </Field>
        )}

        {p.kind === "session_status" && (
          <p className="inline-flex items-center gap-1.5 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-sm text-steel">
            <CalendarCheck className="size-4 text-gold" /> Approving sets the session to <b className="text-bone">{p.newStatus}</b>.
          </p>
        )}

        {p.kind === "note_only" && !action.artifactId && (
          <p className="inline-flex items-center gap-1.5 text-xs text-steel/70">
            <Sparkles className="size-3.5 text-gold" /> Internal note - approving logs it.
          </p>
        )}
      </DialogBody>

      <DialogFooter className="flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => run(() => snooze({ id: action._id, until: Date.now() + DAY }), "Snoozed 24h.")}>
          <Clock className="size-4" /> Snooze 24h
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => run(() => dismiss({ id: action._id }), "Dismissed.")}>
          <X className="size-4" /> Dismiss
        </Button>
        <Button disabled={busy} onClick={doApprove}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : (isEmail ? <Mail className="size-4" /> : <Check className="size-4" />)}
          Approve
        </Button>
      </DialogFooter>
    </>
  );
}
