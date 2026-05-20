"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  ExternalLink,
  Eye,
  LogIn,
  MoreHorizontal,
  Pause,
  Play,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { money, relativeTime } from "@/lib/format";
import {
  PLAN_LABEL,
  type Plan,
  STATUS_LABEL,
  STATUS_TONE,
  type SubStatus,
} from "@/components/agency/meta";

export type SubaccountRow = {
  orgId: string;
  name: string;
  slug: string;
  plan: Plan;
  status: SubStatus;
  accentColor?: string;
  roomCount: number;
  bookingCount: number;
  collectedCents: number;
  _creationTime: number;
};

/** Shared row-action menu - reused on the list and detail pages. */
export function SubaccountActions({
  orgId,
  slug,
  status,
  align = "end",
}: {
  orgId: string;
  slug: string;
  status: SubStatus;
  align?: "start" | "end";
}) {
  const router = useRouter();
  const setStatus = useMutation(api.agency.setStatus);
  const enterAs = useMutation(api.agency.enterAs);
  const [busy, setBusy] = React.useState(false);

  async function enter() {
    if (busy) return;
    setBusy(true);
    try {
      await enterAs({ orgId });
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enter the studio.");
      setBusy(false);
    }
  }

  async function toggleStatus() {
    if (busy) return;
    const next: SubStatus = status === "active" ? "paused" : "active";
    setBusy(true);
    try {
      await setStatus({ orgId, status: next });
      toast.success(next === "active" ? "Subaccount activated." : "Subaccount paused.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid size-8 place-items-center rounded-md text-ash-dim outline-none transition-colors hover:bg-coal-2 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold/30"
        aria-label="Subaccount actions"
        disabled={busy}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onSelect={() => void enter()}>
          <LogIn />
          Enter studio
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/agency/${orgId}`}>
            <Eye />
            View details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void toggleStatus()}>
          {status === "active" ? <Pause /> : <Play />}
          {status === "active" ? "Pause" : "Activate"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={`/book/${slug}`} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open booking page
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The cross-studio subaccount list. */
export function SubaccountTable({ rows }: { rows: SubaccountRow[] }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <TR>
          <TH>Studio</TH>
          <TH>Plan</TH>
          <TH>Status</TH>
          <TH className="text-right">Rooms</TH>
          <TH className="text-right">Bookings</TH>
          <TH className="text-right">Collected</TH>
          <TH>Created</TH>
          <TH className="w-12" />
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR
            key={row.orgId}
            interactive
            onClick={() => router.push(`/agency/${row.orgId}`)}
          >
            <TD>
              <div className="flex items-center gap-3">
                <span
                  className="size-7 shrink-0 rounded-md border border-hairline-2"
                  style={{ backgroundColor: row.accentColor ?? "#fdb913" }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-bone">{row.name}</p>
                  <p className="truncate font-mono text-[0.6875rem] text-ash-dim">/{row.slug}</p>
                </div>
              </div>
            </TD>
            <TD>
              <Badge tone="neutral">{PLAN_LABEL[row.plan]}</Badge>
            </TD>
            <TD>
              <Badge tone={STATUS_TONE[row.status]} dot>
                {STATUS_LABEL[row.status]}
              </Badge>
            </TD>
            <TD className="text-right font-mono text-ash">{row.roomCount}</TD>
            <TD className="text-right font-mono text-ash">{row.bookingCount}</TD>
            <TD className="text-right font-mono text-bone">
              {money(row.collectedCents, { compact: true })}
            </TD>
            <TD className="whitespace-nowrap text-ash-dim">{relativeTime(row._creationTime)}</TD>
            <TD onClick={(e) => e.stopPropagation()}>
              <SubaccountActions orgId={row.orgId} slug={row.slug} status={row.status} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
