"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, X, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";

const RISK_TONE = { low: "neutral", medium: "caution", high: "critical", critical: "critical" } as const;

export type ApprovalItem = {
  _id: Id<"agentApprovals">;
  actionType: string;
  title: string;
  explanation: string;
  riskLevel: keyof typeof RISK_TONE;
  proposedPayload?: unknown;
  studioName?: string;
};

/** Click-into an approval: review, edit the exact content, then approve or
 *  reject. Email + SMS get structured fields; other actions show the payload. */
export function ApprovalEditDialog({ item, onClose }: { item: ApprovalItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        {item && <Inner key={item._id} item={item} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Inner({ item, onClose }: { item: ApprovalItem; onClose: () => void }) {
  const approve = useMutation(api.agent.approveRequest);
  const reject = useMutation(api.agent.rejectRequest);
  const [busy, setBusy] = React.useState(false);

  const payload = (item.proposedPayload ?? {}) as Record<string, unknown>;
  const structured = item.actionType === "send_email" || item.actionType === "send_sms";
  const [to, setTo] = React.useState(String(payload.to ?? ""));
  const [subject, setSubject] = React.useState(String(payload.subject ?? ""));
  const [body, setBody] = React.useState(String(payload.body ?? ""));

  async function doApprove() {
    setBusy(true);
    try {
      const editedPayload = structured
        ? { ...payload, to: to.trim(), ...(item.actionType === "send_email" ? { subject: subject.trim() } : {}), body: body.trim() }
        : undefined;
      await approve({ id: item._id, editedPayload });
      toast.success("Approved.");
      onClose();
    } catch {
      toast.error("Could not approve.");
    } finally {
      setBusy(false);
    }
  }
  async function doReject() {
    setBusy(true);
    try {
      await reject({ id: item._id });
      toast.success("Rejected.");
      onClose();
    } catch {
      toast.error("Could not reject.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle className="truncate">{item.title}</DialogTitle>
          <Badge tone={RISK_TONE[item.riskLevel] ?? "neutral"}>{item.riskLevel}</Badge>
        </div>
        <DialogDescription>
          {item.studioName ? `${item.studioName} · ` : ""}{item.actionType.replace(/_/g, " ")}
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <div className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-steel/70">Why the agent suggests this</p>
          <p className="mt-1 text-sm text-steel">{item.explanation}</p>
        </div>

        {structured ? (
          <>
            <Field label="To" htmlFor="ap-to">
              <Input id="ap-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={item.actionType === "send_sms" ? "+1..." : "name@email.com"} />
            </Field>
            {item.actionType === "send_email" && (
              <Field label="Subject" htmlFor="ap-subject">
                <Input id="ap-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
            )}
            <Field label="Message" htmlFor="ap-body" hint="Edit anything before it sends.">
              <Textarea id="ap-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Proposed details">
            <pre className="max-h-48 overflow-auto rounded-md border border-graphite/50 bg-coal-2 p-3 text-xs text-steel">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </Field>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={doReject} disabled={busy}><X className="size-4" />Reject</Button>
        <Button onClick={doApprove} disabled={busy || (structured && !body.trim())}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {structured ? "Approve & send" : "Approve"}
        </Button>
      </DialogFooter>
    </>
  );
}
