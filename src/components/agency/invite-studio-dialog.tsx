"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/feedback";
import { type Plan, PLAN_LABEL } from "@/components/agency/meta";

/**
 * Invite portal - the email-first way to bring a studio onto Pulse. The agency
 * types just an email (and optionally a studio name); the studio is provisioned
 * immediately and the owner gets a branded invite to create their account and
 * run the onboarding wizard. The studio name + branding are theirs to set, so
 * the name field is optional here.
 */
export function InviteStudioDialog({ triggerSize = "md" }: { triggerSize?: "sm" | "md" }) {
  const router = useRouter();
  const inviteStudio = useAction(api.agency.inviteStudio);

  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [studioName, setStudioName] = React.useState("");
  const [plan, setPlan] = React.useState<Plan>("studio");
  const [submitting, setSubmitting] = React.useState(false);

  function reset() {
    setEmail("");
    setStudioName("");
    setPlan("studio");
  }

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await inviteStudio({
        email: email.trim(),
        studioName: studioName.trim() || undefined,
        plan,
      });
      toast.success(
        res.inviteSent
          ? `Invite sent to ${email.trim()}. They’ll set up the studio from the link.`
          : `Studio created. Invite email is simulated until Resend is configured - the owner can still use the invite link.`,
      );
      setOpen(false);
      reset();
      router.push(`/agency/${res.orgId}`);
    } catch (err) {
      const msg =
        err instanceof ConvexError
          ? typeof err.data === "string"
            ? err.data
            : ((err.data as { message?: string })?.message ?? "Could not send the invite.")
          : "Could not send the invite. Try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size={triggerSize}>
          <Send />
          Invite studio
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Invite a studio</DialogTitle>
          <DialogDescription>
            Enter the owner’s email. They’ll get a branded invite to create their account and
            set up their studio - logo, details, rooms - in a guided onboarding.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Owner email" htmlFor="inv-email">
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@studio.com"
                autoComplete="off"
                autoFocus
              />
            </Field>
            <Field
              label="Studio name"
              htmlFor="inv-name"
              hint="Optional - the owner can name it during onboarding."
            >
              <Input
                id="inv-name"
                value={studioName}
                onChange={(e) => setStudioName(e.target.value)}
                placeholder="Skyline Sound"
                autoComplete="off"
              />
            </Field>
            <Field label="Plan">
              <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PLAN_LABEL) as Plan[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PLAN_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Spinner className="text-gold-ink" />}
              {submitting ? "Sending" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
