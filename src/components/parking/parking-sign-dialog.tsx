"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { parkingSignHtml } from "@/lib/parking-sign";
import { openSignWindow } from "@/lib/sign-window";

/* The one shared reserved-parking print flow. The name arrives prefilled
   (booking artist, visit-log entry) but stays EDITABLE - sessions are often
   named with placeholders, and the sign should carry the guest's real name.
   Prints with the current org's branding; onPrinted fires only after the
   print window opens (checklists mark themselves there, not on open). */
export function ParkingSignDialog({
  open,
  onOpenChange,
  initialName = "",
  suggestions = [],
  onPrinted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  suggestions?: string[];
  onPrinted?: (name: string) => void;
}) {
  const org = useQuery(api.orgs.current);
  const [guest, setGuest] = React.useState(initialName);

  // Re-seed with the caller's prefill each time the dialog opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setGuest(initialName);
  }

  function print() {
    const name = guest.trim();
    if (!name) return;
    openSignWindow(parkingSignHtml(org ?? { name: "Pulse Studio" }, name));
    onPrinted?.(name);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Parking spot sign</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-steel/70">
            Prints a branded reserved-parking sign. The name is prefilled from the booking -
            edit it if the session uses a placeholder name.
          </p>
          <Field label="Name on the sign">
            <Input
              value={guest}
              onChange={(e) => setGuest(e.target.value)}
              placeholder="e.g. Mira Quartz"
              list={suggestions.length ? "parking-sign-names" : undefined}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  print();
                }
              }}
            />
            {suggestions.length > 0 && (
              <datalist id="parking-sign-names">
                {suggestions.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="w-full" disabled={!guest.trim()} onClick={print}>
            <Printer className="size-4" />
            Print parking sign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
