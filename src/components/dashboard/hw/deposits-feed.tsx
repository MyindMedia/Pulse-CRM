"use client";

import Link from "next/link";
import { useSnapshotQuery } from "@/lib/boot-snapshot";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/format";
import { SessionLink } from "@/components/shell/entity-link";
import { Chassis, ChassisTitle, EmptyWell, usd } from "./parts";

/* Deposits (kit 6.2 "deposits feed"): the deposits that cleared most
 * recently, each with its client, room and booking date. The chip says
 * Stripe synced only when the studio's Stripe account can take charges. */
export function DepositsFeed() {
  const rows = useSnapshotQuery(api.payments.recentDeposits, { limit: 6 });
  const stripe = useSnapshotQuery(api.stripeConnect.status, {});

  return (
    <Chassis>
      <ChassisTitle
        title="Deposits"
        bar={false}
        right={stripe?.chargesEnabled ? <Badge tone="info">Stripe synced</Badge> : null}
      />
      {rows === undefined ? (
        <div className="mt-3 flex-1" aria-busy />
      ) : rows.length === 0 ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell
            action={
              !stripe?.chargesEnabled ? (
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/payments">Set up payments</Link>
                </Button>
              ) : undefined
            }
          >
            No deposits yet.
          </EmptyWell>
        </div>
      ) : (
        <ul className="pl-well mt-3 flex-1 px-3.5 py-1">
          {rows.map((d, i) => (
            <li
              key={d._id}
              className={`flex items-center justify-between gap-3 py-3 ${i ? "border-t border-white/[0.06]" : ""}`}
            >
              {/* The deposit opens the booking it paid for, in place. */}
              {d.sessionId ? (
                <SessionLink sessionId={d.sessionId} title="Open booking" className="block min-w-0 hover:text-gold">
                  <p className="truncate font-sans text-sm leading-5 text-bone">{d.clientName}</p>
                  <p className="truncate font-sans text-[11px] leading-4 text-steel">
                    {[d.roomName, d.sessionStart ? shortDate(d.sessionStart) : null].filter(Boolean).join(", ")}
                  </p>
                </SessionLink>
              ) : (
                <div className="min-w-0">
                  <p className="truncate font-sans text-sm leading-5 text-bone">{d.clientName}</p>
                  <p className="truncate font-sans text-[11px] leading-4 text-steel">
                    {[d.roomName, d.sessionStart ? shortDate(d.sessionStart) : null].filter(Boolean).join(", ")}
                  </p>
                </div>
              )}
              <span className="shrink-0 font-mono text-[13px] text-positive tabular-nums">+{usd(d.amountCents, { cents: true })}</span>
            </li>
          ))}
        </ul>
      )}
    </Chassis>
  );
}
