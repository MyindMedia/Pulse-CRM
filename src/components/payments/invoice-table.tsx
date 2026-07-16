"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Eye,
  Send,
  CheckCircle2,
  Ban,
  Trash2,
} from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { money, relativeTime, shortDate } from "@/lib/format";
import { meta, INVOICE_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { InvoiceRow } from "./types";
import { categoryMeta } from "./category";
import { RecordPaymentDialog, type RecordPaymentTarget } from "./record-payment-dialog";

/** Stops a click inside the actions cell from also opening the row link. */
function swallow(e: React.MouseEvent) {
  e.stopPropagation();
}

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  const router = useRouter();
  const setStatus = useMutation(api.invoices.setStatus);
  const remove = useMutation(api.invoices.remove);
  const [recordTarget, setRecordTarget] = React.useState<RecordPaymentTarget | null>(null);

  async function changeStatus(
    id: Id<"invoices">,
    status: "sent" | "void",
    verb: string,
  ) {
    try {
      const res = await setStatus({ id, status });
      if (status === "sent") {
        toast.success(
          res?.emailed
            ? "Invoice emailed to the client with a payment link."
            : "Invoice marked sent - the client has no email on file, so share the payment link manually.",
        );
      } else {
        toast.success(`Invoice ${verb}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function deleteInvoice(id: Id<"invoices">, number: string) {
    try {
      await remove({ id });
      toast.success(`Invoice ${number} deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <>
    <Table>
      <THead>
        <TR>
          <TH>Invoice</TH>
          <TH>Client</TH>
          <TH>For</TH>
          <TH className="text-right">Amount</TH>
          <TH>Status</TH>
          <TH>Due</TH>
          <TH>Created</TH>
          <TH className="w-12" />
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const st = meta(INVOICE_STATUS, row.status);
          const overdue = row.status === "overdue";
          return (
            <TR
              key={row._id}
              interactive
              onClick={() => router.push(`/payments/${row._id}`)}
              className={cn(overdue && "bg-critical/[0.04]")}
            >
              <TD className="font-meta text-xs text-bone">{row.number}</TD>
              <TD>
                <span className="flex items-center gap-2.5">
                  <Avatar name={row.artistName} size="sm" />
                  <span className="truncate font-medium text-bone">{row.artistName}</span>
                </span>
              </TD>
              <TD>
                {(() => {
                  const c = categoryMeta(row.category);
                  const Icon = c.icon;
                  return (
                    <Badge tone={c.tone}>
                      <Icon className="size-3" />
                      {c.label}
                    </Badge>
                  );
                })()}
              </TD>
              <TD className="text-right font-meta tabular-nums text-bone">
                {money(row.amountCents)}
              </TD>
              <TD>
                <Badge tone={st.tone}>{st.label}</Badge>
              </TD>
              <TD>
                <span
                  className={cn(
                    "font-meta text-xs",
                    overdue ? "font-medium text-critical" : "text-steel",
                  )}
                >
                  {shortDate(row.dueDate)}
                </span>
              </TD>
              <TD className="text-xs text-steel/70">{relativeTime(row._creationTime)}</TD>
              <TD onClick={swallow}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${row.number}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{row.number}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => router.push(`/payments/${row._id}`)}>
                      <Eye className="size-4" />
                      View
                    </DropdownMenuItem>
                    {(row.status === "draft" || row.status === "void") && (
                      <DropdownMenuItem
                        onSelect={() => changeStatus(row._id, "sent", "sent")}
                      >
                        <Send className="size-4" />
                        Send
                      </DropdownMenuItem>
                    )}
                    {row.status !== "paid" && row.status !== "void" && (
                      <DropdownMenuItem
                        onSelect={() =>
                          setRecordTarget({
                            id: row._id,
                            number: row.number,
                            amountCents: row.amountCents,
                          })
                        }
                      >
                        <CheckCircle2 className="size-4" />
                        Mark paid
                      </DropdownMenuItem>
                    )}
                    {row.status !== "void" && row.status !== "paid" && (
                      <DropdownMenuItem
                        onSelect={() => changeStatus(row._id, "void", "voided")}
                      >
                        <Ban className="size-4" />
                        Void
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() => deleteInvoice(row._id, row.number)}
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
    <RecordPaymentDialog
      open={recordTarget !== null}
      onOpenChange={(o) => {
        if (!o) setRecordTarget(null);
      }}
      invoice={recordTarget}
    />
    </>
  );
}
