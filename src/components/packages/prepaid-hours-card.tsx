"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Clock3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { useCapabilities } from "@/lib/use-capabilities";
import { SellDialog } from "./sell-dialog";

/* Prepaid hours on the client's profile: what they bought and what is left.
   Selling needs the finance role and the Growth plan; seeing the balance
   needs only session access, so the floor can tell a client what they have. */
export function PrepaidHoursCard({ artistId, clientName }: { artistId: Id<"artists">; clientName: string }) {
  const data = useQuery(api.packages.balanceForArtist, { artistId });
  const { can } = useCapabilities();
  const [selling, setSelling] = React.useState(false);
  if (!data) return null;
  const sellable = data.canSell && can("invoices.send");
  if (data.credits.length === 0 && !sellable) return null;

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <Clock3 className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-grotesk text-sm font-semibold text-bone">Prepaid hours</p>
              <Badge tone={data.hoursRemaining > 0 ? "positive" : "neutral"}>{data.hoursRemaining}h left</Badge>
            </div>
            <p className="mt-0.5 text-xs text-steel">
              {data.credits.length === 0
                ? `${clientName} has no prepaid hours.`
                : "Hours come off when a session paid with them is completed."}
            </p>
          </div>
          {sellable && (
            <Button size="sm" variant="secondary" onClick={() => setSelling(true)}>
              Sell hours
            </Button>
          )}
        </div>
        {data.credits.length > 0 && (
          <ul className="space-y-1 text-xs text-steel">
            {data.credits.map((c) => (
              <li key={c._id} className="flex justify-between gap-2">
                <span>
                  {c.name} · {c.source === "manual" ? "paid in person" : "paid online"} {shortDate(c.purchasedAt)}
                </span>
                <span className="font-meta text-bone">
                  {c.hoursRemaining} / {c.hoursTotal}h
                </span>
              </li>
            ))}
          </ul>
        )}
        {sellable && (
          <SellDialog open={selling} onOpenChange={setSelling} artistId={artistId} artistName={clientName} />
        )}
      </CardContent>
    </Card>
  );
}
