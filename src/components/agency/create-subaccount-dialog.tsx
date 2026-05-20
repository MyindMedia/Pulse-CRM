"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { type Plan, PLAN_LABEL, slugify } from "@/components/agency/meta";

/** "New subaccount" - provisions a studio org (Clerk org when configured). */
export function CreateSubaccountDialog({ triggerSize = "md" }: { triggerSize?: "sm" | "md" }) {
  const router = useRouter();
  const createSubaccount = useAction(api.agency.createSubaccount);

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugDirty, setSlugDirty] = React.useState(false);
  const [plan, setPlan] = React.useState<Plan>("studio");
  const [ownerName, setOwnerName] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const effectiveSlug = slugDirty ? slug : slugify(name);

  function reset() {
    setName("");
    setSlug("");
    setSlugDirty(false);
    setPlan("studio");
    setOwnerName("");
    setOwnerEmail("");
  }

  const valid =
    name.trim().length > 1 &&
    effectiveSlug.length > 1 &&
    ownerName.trim().length > 1 &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await createSubaccount({
        name: name.trim(),
        slug: effectiveSlug,
        plan,
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
      });
      toast.success(
        res.clerkProvisioned
          ? `${name.trim()} created - a Clerk organization was provisioned and the owner was invited.`
          : `${name.trim()} created as a demo workspace (no real login until CLERK_SECRET_KEY is set).`,
      );
      setOpen(false);
      reset();
      router.push(`/agency/${res.orgId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the subaccount.");
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
          <Plus />
          New subaccount
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New studio subaccount</DialogTitle>
          <DialogDescription>
            Provision a studio workspace - its own org, two starter rooms, and an owner member.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Studio name" htmlFor="sub-name">
              <Input
                id="sub-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Skyline Sound"
                autoComplete="off"
                autoFocus
              />
            </Field>
            <Field
              label="Slug"
              htmlFor="sub-slug"
              hint={`Public booking page - /book/${effectiveSlug || "your-studio"}`}
            >
              <Input
                id="sub-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugDirty(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="skyline-sound"
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner name" htmlFor="sub-owner">
                <Input
                  id="sub-owner"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Jordan Vega"
                  autoComplete="off"
                />
              </Field>
              <Field label="Owner email" htmlFor="sub-email">
                <Input
                  id="sub-email"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@studio.com"
                  autoComplete="off"
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!valid || submitting}>
              {submitting && <Spinner className="text-gold-ink" />}
              {submitting ? "Provisioning" : "Create subaccount"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
