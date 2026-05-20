"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Mail, MessageSquare, Receipt } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, relativeTime } from "@/lib/format";
import { titleCase } from "@/lib/labels";
import type { NotificationRow, PaymentRow } from "./types";

/** Read-only feed of the most recent cleared payments workspace-wide. */
export function RecentPaymentsPanel() {
  const payments = useQuery(api.payments.recent, { limit: 8 }) as
    | PaymentRow[]
    | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent payments</CardTitle>
        <CardDescription>Cleared payments across the workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {payments === undefined ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline-2 py-8 text-center text-xs text-ash-dim">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {payments.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-coal-3 text-ash-dim">
                    <Receipt className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-bone">
                      {titleCase(p.kind)} payment
                    </span>
                    <span className="block truncate font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                      {titleCase(p.provider)}
                      {p.payerName ? ` · ${p.payerName}` : ""}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-semibold tabular-nums text-positive">
                    {money(p.amountCents)}
                  </span>
                  <span className="block text-[0.625rem] text-ash-dim">
                    {relativeTime(p.paidAt ?? p._creationTime)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Read-only feed of the most recent confirmations and reminders. */
export function MessagesPanel() {
  const messages = useQuery(api.notifications.recent, { limit: 8 }) as
    | NotificationRow[]
    | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages</CardTitle>
        <CardDescription>
          Confirmations and reminders are simulated and logged here - not
          actually emailed yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {messages === undefined ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline-2 py-8 text-center text-xs text-ash-dim">
            No messages logged yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {messages.map((msg) => (
              <li
                key={msg._id}
                className="rounded-md border border-hairline bg-coal-2 p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-bone">
                    {msg.channel === "email" ? (
                      <Mail className="size-3.5 shrink-0 text-ash-dim" />
                    ) : (
                      <MessageSquare className="size-3.5 shrink-0 text-ash-dim" />
                    )}
                    <span className="truncate">{msg.subject}</span>
                  </span>
                  <Badge tone="neutral">{msg.channel}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ash">
                  {msg.body}
                </p>
                <p className="mt-1 font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">
                  {msg.recipient} · {relativeTime(msg._creationTime)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
