"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardCapture } from "@/components/payments/card-capture";

/* Card on file, on the client's own profile.

   The point of holding a card is the No-Show Shield: a late cancel or a
   no-show becomes a charge against the studio's stated policy instead of a
   lost night. Saying that out loud here is deliberate - a studio that does not
   know why it is asking will not ask. */

export function CardOnFileCard({
  artistId,
  hasCard,
  clientName,
}: {
  artistId: Id<"artists">;
  hasCard: boolean;
  clientName: string;
}) {
  const [adding, setAdding] = React.useState(false);

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
                ? `${clientName} has a card saved. Late cancels and no-shows can be charged against your policy without chasing them.`
                : `Hold a card so a no-show becomes a charge instead of a lost night. ${clientName} enters it themselves; you never see the number.`}
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
              <p className="flex items-center gap-1.5 text-xs text-steel/80">
                <ShieldCheck className="size-3.5 text-positive" />
                Stored with Stripe on your connected account.{" "}
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="text-gold underline-offset-2 hover:underline"
                >
                  Replace it
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
