"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Mail } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type SigningLink = { name: string; email: string; token: string; contributorIndex: number };

/** Shows the studio the per-contributor signing links it just issued so they
 *  can paste them into an email if the auto-send seam is not configured. */
export function SigningLinksDialog({
  links, open, onOpenChange,
}: {
  links: SigningLink[] | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlFor = (token: string) => `${origin}/sign/${token}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Signing links ready</DialogTitle>
          <DialogDescription>
            Each unsigned contributor with an email got a one-use signing link. Paste them
            into your email tool if you have not connected automatic sends yet.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {!links || links.length === 0 ? (
            <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
              No new links were issued. Either everyone has already signed, or no unsigned
              contributor has an email on file.
            </p>
          ) : (
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.token} className="rounded-md border border-graphite/50 bg-coal-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-bone">{l.name}</p>
                      <p className="truncate font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                        <Mail className="mr-1 inline size-3" /> {l.email}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copy(urlFor(l.token))}>
                      <Copy className="size-3.5" /> Copy link
                    </Button>
                  </div>
                  <p className="mt-2 truncate font-meta text-[0.625rem] text-steel/70">{urlFor(l.token)}</p>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
