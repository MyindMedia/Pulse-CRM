"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Edit05, Plus } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { checkLocalPart, checkDisplayName, MAIL_DOMAIN } from "@convex/mail/address";

export type MailboxOption = { _id: Id<"mailboxes">; address: string; displayName: string; fromName: string };

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"] */
export function splitAddresses(value: string): string[] {
  return value.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

export function NewInboxDialog({ onCreated }: { onCreated?: (id: Id<"mailboxes">) => void }) {
  const create = useMutation(api.mail.createMailbox);
  const [open, setOpen] = React.useState(false);
  const [localPart, setLocalPart] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const lp = localPart ? checkLocalPart(localPart) : null;
  const dn = displayName ? checkDisplayName(displayName) : null;
  const ready = lp?.ok && dn?.ok;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      const out = await create({ localPart, displayName });
      toast.success(`${out.address} is ready.`);
      onCreated?.(out.id);
      setOpen(false);
      setLocalPart("");
      setDisplayName("");
    } catch (err) {
      toast.error(errorMessage(err, "Could not create that inbox."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus aria-hidden /> New inbox</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New inbox</DialogTitle>
            <DialogDescription>Mail to this address lands here once receiving is on for {MAIL_DOMAIN}.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Address" htmlFor="new-inbox-local" hint={lp && !lp.ok ? lp.error : "Lowercase a-z, 0-9, dot, underscore and hyphen."}>
              <div className="flex items-center gap-2">
                <Input
                  id="new-inbox-local" value={localPart} autoComplete="off" autoCapitalize="none" spellCheck={false}
                  onChange={(e) => setLocalPart(e.target.value.trim())} placeholder="bookings" aria-invalid={lp ? !lp.ok : undefined}
                />
                <span className="shrink-0 font-meta text-xs text-steel">@{MAIL_DOMAIN}</span>
              </div>
            </Field>
            <Field label="Display name" htmlFor="new-inbox-name" hint={dn && !dn.ok ? dn.error : "Shown in the inbox list and as the sender name."}>
              <Input id="new-inbox-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Bookings" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={!ready || busy}>{busy ? "Creating" : "Create inbox"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ComposeDialog({ mailboxes, defaultMailboxId, onSent }: {
  mailboxes: MailboxOption[];
  defaultMailboxId?: Id<"mailboxes">;
  onSent?: (threadId: Id<"mailThreads">, mailboxId: Id<"mailboxes">) => void;
}) {
  const send = useMutation(api.mail.send);
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState<string>("");
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fromId = (from || defaultMailboxId || mailboxes[0]?._id || "") as Id<"mailboxes"> | "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId) return;
    setBusy(true);
    try {
      const out = await send({ mailboxId: fromId, to: splitAddresses(to), cc: splitAddresses(cc), subject, body });
      toast.success("Sending.");
      onSent?.(out.threadId, fromId);
      setOpen(false);
      setTo(""); setCc(""); setSubject(""); setBody("");
    } catch (err) {
      toast.error(errorMessage(err, "That did not send."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={mailboxes.length === 0}><Edit05 aria-hidden /> Compose</Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New message</DialogTitle>
            <DialogDescription>Sent through Resend from the inbox you pick.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="From" htmlFor="compose-from">
              <Select value={fromId || undefined} onValueChange={setFrom}>
                <SelectTrigger id="compose-from"><SelectValue placeholder="Choose an inbox" /></SelectTrigger>
                <SelectContent>
                  {mailboxes.map((m) => (
                    <SelectItem key={m._id} value={m._id}>{m.fromName} &lt;{m.address}&gt;</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="To" htmlFor="compose-to" hint="Separate several addresses with commas.">
              <Input id="compose-to" type="text" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
            </Field>
            <Field label="Cc" htmlFor="compose-cc">
              <Input id="compose-cc" type="text" inputMode="email" autoComplete="off" value={cc} onChange={(e) => setCc(e.target.value)} />
            </Field>
            <Field label="Subject" htmlFor="compose-subject">
              <Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" htmlFor="compose-body">
              <Textarea id="compose-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={busy || !fromId || !to.trim() || !subject.trim() || !body.trim()}>
              {busy ? "Sending" : "Send"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
