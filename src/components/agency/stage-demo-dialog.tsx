"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { ExternalLink, Sparkles } from "lucide-react";
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
import { Spinner } from "@/components/ui/feedback";

/** "Stage demo" - scrapes the prospect's website and spins up a fully branded
 *  sub-account (logo, brand colors, rooms with photos, AI hero) preloaded with
 *  demo data. Slow (10-60s), so the dialog holds a persistent busy state. */
export function StageDemoDialog({ triggerSize = "md" }: { triggerSize?: "sm" | "md" }) {
  const stageDemo = useAction(api.stageDemo.stage);

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [staged, setStaged] = React.useState<{ name: string; slug: string } | null>(null);

  function reset() {
    setName("");
    setWebsite("");
    setStaged(null);
  }

  const valid = name.trim().length > 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await stageDemo({
        name: name.trim(),
        website: website.trim() || undefined,
      });
      toast.success(`Staged ${name.trim()} - demo data loaded.`);
      setStaged({ name: name.trim(), slug: res.slug });
    } catch (err) {
      toast.error(
        err instanceof ConvexError
          ? String(err.data)
          : "Could not stage the demo account. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return; // hold the dialog while the build runs
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size={triggerSize} variant="secondary">
          <Sparkles />
          Stage demo
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        {staged ? (
          <>
            <DialogHeader>
              <DialogTitle>Demo account staged</DialogTitle>
              <DialogDescription>
                {staged.name} is branded, configured, and loaded with demo data.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <Button variant="outline" asChild>
                <a href={`/book/${staged.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open booking page · /book/{staged.slug}
                </a>
              </Button>
              <p className="text-sm text-steel">
                Enter the account from the table below to demo the dashboard.
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Stage a demo account</DialogTitle>
              <DialogDescription>
                Point Pulse at a prospect&apos;s website and it builds a fully branded
                sub-account - logo, colors, rooms - preloaded with demo data for the pitch.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <DialogBody className="space-y-4">
                <Field label="Company name" htmlFor="stage-name">
                  <Input
                    id="stage-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Skyline Sound"
                    autoComplete="off"
                    autoFocus
                    disabled={submitting}
                  />
                </Field>
                <Field
                  label="Website"
                  htmlFor="stage-website"
                  hint="Optional - used to pull the logo, brand colors, and room photos."
                >
                  <Input
                    id="stage-website"
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://studioname.com"
                    autoComplete="off"
                    disabled={submitting}
                  />
                </Field>
                {submitting && (
                  <p className="flex items-center gap-2 text-sm text-steel">
                    <Spinner />
                    Building branded demo… this can take a minute.
                  </p>
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" disabled={submitting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={!valid || submitting}>
                  {submitting && <Spinner className="text-gold-ink" />}
                  {submitting ? "Building" : "Stage demo"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
