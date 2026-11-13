"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import dynamic from "next/dynamic";

/* Stripe Elements is ~1.3MB and is only needed once somebody actually decides
   to add a card. Loading it lazily keeps it off every client-profile page
   view, which is the common case by a wide margin. */
const CardCapture = dynamic(
  () => import("@/components/payments/card-capture").then((m) => m.CardCapture),
  {
    ssr: false,
    loading: () => <p className="text-xs text-steel">Loading the secure card form…</p>,
  },
);

/* Card on file, on the client's own profile.

   Staff see whether a card is saved (and which), and can remove it. A fee is
   charged to a saved card only when the studio owner switched card charging
   on and the client agreed at checkout for that booking; otherwise fees go
   out as an invoice. The panel says which applies, plainly. */

export function CardOnFileCard({
  artistId,
  clientName,
}: {
  artistId: Id<"artists">;
  clientName: string;
}) {
  const status = useQuery(api.cardOnFile.cardStatus, { artistId });
  const removeCard = useMutation(api.cardOnFile.removeCard);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  // No money access (or still loading): nothing to show.
  if (!status) return null;
  const { hasCard } = status;
  const which = status.last4 ? `${status.brand ?? "Card"} ending ${status.last4}` : "A card";

  async function onRemove() {
    if (!window.confirm(`Remove ${clientName}'s saved card? Pulse will not charge it again.`)) return;
    setRemoving(true);
    try {
      await removeCard({ artistId });
      toast.success("Card removed. It will not be charged.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the card.");
    } finally {
      setRemoving(false);
    }
  }

  const how = !status.autoChargeOn
    ? "Card charging is off for this studio, so late-cancel and no-show fees go out as an invoice."
    : "Only a no-show fee is charged to a card, and only for bookings where the client agreed at checkout. Late-cancel fees and anything else go out as an invoice.";

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <CreditCard className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-grotesk text-sm font-semibold text-bone">Card on file</p>
              {hasCard ? (
                <Badge tone="positive" dot>
                  Saved
                </Badge>
              ) : (
                <Badge tone="neutral">Not saved</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-steel">
              {hasCard
                ? `${which} is saved for ${clientName}${status.savedVia === "checkout" ? " (saved at checkout)" : ""}. ${how}`
                : `${clientName} has no card saved. ${how}`}
            </p>
          </div>
        </div>

        {!hasCard && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-gold underline-offset-2 hover:underline"
          >
            Add a card now
          </button>
        )}

        {(adding || hasCard) && (
          <div className="rounded-md border border-graphite/50 bg-coal/30 p-3">
            {hasCard && !adding ? (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-steel/80">
                <ShieldCheck className="size-3.5 text-positive" />
                Stored with Stripe on your connected account.{" "}
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="text-gold underline-offset-2 hover:underline"
                >
                  Replace it
                </button>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing}
                  className="text-critical underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {removing ? "Removing…" : "Remove card"}
                </button>
              </p>
            ) : (
              <CardCapture artistId={artistId} onSaved={() => setAdding(false)} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
