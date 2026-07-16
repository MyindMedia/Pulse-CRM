"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Globe, Plus } from "lucide-react";
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

type SiteImport = {
  name: string | null;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string;
  logoStorageId: string | null;
  logoPreviewUrl: string | null;
};

/** "New subaccount" - provisions a studio org (Clerk org when configured). */
export function CreateSubaccountDialog({ triggerSize = "md" }: { triggerSize?: "sm" | "md" }) {
  const router = useRouter();
  const createSubaccount = useAction(api.agency.createSubaccount);
  const fetchFromSite = useAction(api.studioImport.fetchFromSite);
  const applyImport = useMutation(api.studioImport.applyToOrg);

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugDirty, setSlugDirty] = React.useState(false);
  const [plan, setPlan] = React.useState<Plan>("studio");
  const [ownerName, setOwnerName] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [siteUrl, setSiteUrl] = React.useState("");
  const [fetching, setFetching] = React.useState(false);
  const [imported, setImported] = React.useState<SiteImport | null>(null);

  const effectiveSlug = slugDirty ? slug : slugify(name);

  function reset() {
    setName("");
    setSlug("");
    setSlugDirty(false);
    setPlan("studio");
    setOwnerName("");
    setOwnerEmail("");
    setSiteUrl("");
    setImported(null);
  }

  /** Pull logo + basics from the studio's existing website to prefill. */
  async function handleFetchSite() {
    if (!siteUrl.trim() || fetching) return;
    setFetching(true);
    try {
      const res = await fetchFromSite({ url: siteUrl.trim() });
      setImported(res as SiteImport);
      if (res.name && !name.trim()) setName(res.name);
      const found = [
        res.logoStorageId && "logo",
        res.name && "name",
        res.tagline && "tagline",
        res.email && "email",
        res.phone && "phone",
        res.address && "address",
      ].filter(Boolean);
      toast[found.length ? "success" : "info"](
        found.length
          ? `Pulled ${found.join(", ")} from their site - applied when you create the subaccount.`
          : "Reached the site but couldn't find branding info - you can fill things in manually.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error && !/Server Error/i.test(err.message)
          ? err.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0]
          : "Could not read that website.",
      );
    } finally {
      setFetching(false);
    }
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
      // Best-effort: apply anything pulled from their existing website. The
      // subaccount already exists, so a failed apply must not fail creation.
      if (imported) {
        try {
          await applyImport({
            orgId: res.orgId,
            logoStorageId: (imported.logoStorageId ?? undefined) as never,
            tagline: imported.tagline ?? undefined,
            email: imported.email ?? undefined,
            phone: imported.phone ?? undefined,
            address: imported.address ?? undefined,
            website: imported.website,
          });
        } catch {
          toast.warning("Created, but the imported branding could not be applied - set it in their Settings.");
        }
      }
      toast.success(
        res.clerkProvisioned
          ? `${name.trim()} created - a Clerk organization was provisioned and the owner was invited.`
          : `${name.trim()} created as a demo workspace (no real login until CLERK_SECRET_KEY is set).`,
      );
      setOpen(false);
      reset();
      router.push(`/agency/${res.orgId}`);
    } catch (err) {
      // ConvexError carries the user-facing reason in `.data`; plain errors
      // get redacted to "Server Error" by Convex, so fall back to a hint.
      const msg =
        err instanceof ConvexError
          ? String(err.data)
          : err instanceof Error && !/Server Error/i.test(err.message)
            ? err.message
            : "Could not create the subaccount - check the slug isn't already taken.";
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
            <Field
              label="Studio website (optional)"
              htmlFor="sub-site"
              hint="Pulls their logo and basic info to prefill the workspace."
            >
              <div className="flex gap-2">
                <Input
                  id="sub-site"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="studioname.com"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleFetchSite();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleFetchSite}
                  disabled={!siteUrl.trim() || fetching}
                >
                  {fetching ? <Spinner /> : <Globe className="size-4" />}
                  {fetching ? "Fetching" : "Fetch"}
                </Button>
              </div>
            </Field>
            {imported && (
              <div className="flex items-center gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
                {imported.logoPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imported.logoPreviewUrl}
                    alt="Imported logo"
                    className="size-10 rounded-md bg-white object-contain p-1"
                  />
                ) : (
                  <span className="grid size-10 place-items-center rounded-md bg-coal-3 text-steel/70">
                    <Globe className="size-4" />
                  </span>
                )}
                <div className="min-w-0 text-xs text-steel">
                  <p className="truncate font-medium text-bone">
                    {imported.name ?? "Site reached"}
                    {imported.logoStorageId ? " · logo found" : ""}
                  </p>
                  <p className="truncate text-steel/70">
                    {[imported.email, imported.phone, imported.address].filter(Boolean).join(" · ") ||
                      imported.tagline ||
                      "Applied when the subaccount is created"}
                  </p>
                </div>
              </div>
            )}
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
