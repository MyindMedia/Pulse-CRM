"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Send, Eye, CreditCard, Bell, Ban, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import type { InvoiceStatus } from "./types";

/** Status-contextual action buttons for an invoice detail view. */
export function InvoiceActions({
  id,
  number,
  status,
}: {
  id: Id<"invoices">;
  number: string;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  const setStatus = useMutation(api.invoices.setStatus);
  const sendReminder = useMutation(api.invoices.sendReminder);
  const remove = useMutation(api.invoices.remove);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function transition(
    next: "sent" | "viewed" | "paid" | "void",
    verb: string,
    key: string,
  ) {
    setBusy(key);
    try {
      const res = await setStatus({ id, status: next });
      if (next === "sent") {
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
    } finally {
      setBusy(null);
    }
  }

  async function handleReminder() {
    setBusy("remind");
    try {
      const res = await sendReminder({ id });
      toast.success(
        res.emailed
          ? `Reminder emailed to the client for ${number}`
          : "The client has no email on file, so share the payment link manually.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the reminder");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      await remove({ id });
      toast.success(`Invoice ${number} deleted`);
      router.push("/payments");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  const settled = status === "paid";
  const voided = status === "void";
  const live = !settled && !voided;

  return (
    <>
      <div className="space-y-2">
        {(status === "draft" || status === "void") && (
          <Button
            className="w-full justify-start"
            onClick={() => transition("sent", "sent to client", "send")}
            disabled={busy !== null}
          >
            {busy === "send" ? <Spinner className="text-gold-ink" /> : <Send className="size-4" />}
            Send invoice
          </Button>
        )}

        {status === "sent" || status === "overdue" ? (
          <Button
            variant="secondary"
            className="w-full justify-start"
            onClick={() => transition("viewed", "marked as viewed", "viewed")}
            disabled={busy !== null}
          >
            {busy === "viewed" ? <Spinner /> : <Eye className="size-4" />}
            Mark as viewed
          </Button>
        ) : null}

        {live && (
          <Button
            variant={status === "draft" ? "secondary" : "primary"}
            className="w-full justify-start"
            onClick={() => transition("paid", "marked paid", "paid")}
            disabled={busy !== null}
          >
            {busy === "paid" ? (
              <Spinner className={status === "draft" ? undefined : "text-gold-ink"} />
            ) : (
              <CreditCard className="size-4" />
            )}
            Record payment
          </Button>
        )}

        {(status === "sent" || status === "viewed" || status === "overdue") && (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleReminder}
            disabled={busy !== null}
          >
            {busy === "remind" ? <Spinner /> : <Bell className="size-4" />}
            Send reminder
          </Button>
        )}

        {live && (
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => transition("void", "voided", "void")}
            disabled={busy !== null}
          >
            {busy === "void" ? <Spinner /> : <Ban className="size-4" />}
            Void invoice
          </Button>
        )}

        <Button
          variant="danger"
          className="w-full justify-start"
          onClick={() => setConfirmDelete(true)}
          disabled={busy !== null}
        >
          <Trash2 className="size-4" />
          Delete invoice
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {number}?</DialogTitle>
            <DialogDescription>
              This permanently removes the invoice and its line items. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={busy === "delete"}
            >
              {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />}
              Delete invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
