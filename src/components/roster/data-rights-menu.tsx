"use client";

import * as React from "react";
import { useConvex, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Shield, Download, Trash2, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/** GDPR data-subject rights for one client: export their data (portability) or
 *  erase it (right to be forgotten). Erase is owner/manager-gated server-side. */
export function DataRightsMenu({
  artistId,
  artistName,
  erased,
}: {
  artistId: Id<"artists">;
  artistName: string;
  erased?: boolean;
}) {
  const convex = useConvex();
  const erase = useMutation(api.dataRights.eraseArtist);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function exportData() {
    try {
      const data = await convex.query(api.dataRights.exportArtist, { artistId });
      if (!data) {
        toast.error("Could not export this client's data.");
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `client-data-${artistId}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Client data exported.");
    } catch {
      toast.error("Export failed. Try again.");
    }
  }

  async function doErase() {
    setBusy(true);
    try {
      const r = await erase({ artistId });
      toast.success(
        r.alreadyErased
          ? "This client's data was already erased."
          : `Client data erased - ${r.scrubbed} record(s) scrubbed.`,
      );
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erase failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Shield className="size-4" />
            Privacy
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Data rights (GDPR)</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void exportData()}>
            <Download className="size-4" />
            Export data
          </DropdownMenuItem>
          {!erased && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="size-4" />
                Erase (right to be forgotten)
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Erase {artistName}&apos;s data?</DialogTitle>
            <DialogDescription>
              This anonymizes their name and contact details and scrubs their identity from session
              notes and message history. Financial records (invoices, payments) are kept in
              anonymized form for accounting. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void doErase()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Erase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
