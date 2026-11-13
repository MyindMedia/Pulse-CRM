"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Copy, Link2, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { money } from "@/lib/format";

type Method = "cash" | "card_in_person" | "bank_transfer" | "check" | "other";

const METHODS: { value: Method; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card_in_person", label: "Card, taken in person" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "check", label: "Check" },
  { value: "other", label: "Other" },
];

/** A one-time key per open dialog: a double click or a retry records once. */
function newSaleKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sell a prepaid block to a client. Two ways to take the money:
 *   - a pay link on the studio's own Stripe account, copied to send to the
 *     client (the hours appear once Stripe confirms the payment), or
 *   - recording a payment the studio took in person.
 * Pulse sends nothing to the client from here.
 */
export function SellDialog({
  open,
  onOpenChange,
  artistId: fixedArtistId,
  artistName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artistId?: Id<"artists">;
  artistName?: string;
}) {
  const products = useQuery(api.packages.list, open ? { activeOnly: true } : "skip");
  const roster = useQuery(api.artists.roster, open && !fixedArtistId ? {} : "skip") as
    | { _id: Id<"artists">; name: string }[]
    | undefined;
  const recordSale = useMutation(api.packages.recordSale);
  const payLink = useAction(api.packages.purchaseCheckout);

  const [artistId, setArtistId] = React.useState<string>("");
  const [productId, setProductId] = React.useState<string>("");
  const [mode, setMode] = React.useState<"in_person" | "link">("in_person");
  const [method, setMethod] = React.useState<Method>("cash");
  const [note, setNote] = React.useState("");
  const [saleKey, setSaleKey] = React.useState("");
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Reset whenever the dialog opens (derived-on-change, not an effect).
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setArtistId(fixedArtistId ?? "");
      setProductId("");
      setMode("in_person");
      setMethod("cash");
      setNote("");
      setLink(null);
      setSaleKey(newSaleKey());
    }
  }

  const product = products?.find((p) => p._id === productId) ?? null;
  const ready = Boolean(artistId && product);

  async function record() {
    if (!ready || !product) return;
    setBusy(true);
    try {
      const res = await recordSale({
        productId: product._id,
        artistId: artistId as Id<"artists">,
        paymentMethod: method,
        note: note.trim() || undefined,
        saleKey,
      });
      toast.success(
        res.duplicate ? "Already recorded." : `Recorded. ${product.hours} hours added to the client's prepaid hours.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the sale. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function makeLink() {
    if (!ready || !product) return;
    setBusy(true);
    try {
      const res = await payLink({ productId: product._id, artistId: artistId as Id<"artists"> });
      if (!res.url) {
        toast.error("Connect Stripe in Settings to take payment by link, or record a payment taken in person.");
        return;
      }
      setLink(res.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not make the pay link.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Pay link copied. Send it to the client.");
    } catch {
      toast.error("Could not copy. Select the link and copy it.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <Package className="size-4 text-gold" />
            Sell prepaid hours
          </DialogTitle>
          <DialogDescription>
            The hours are held as the client&apos;s credit. They come off when a session paid
            with them is completed, and go back if that session is voided or refunded.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {fixedArtistId ? (
            <p className="text-sm text-steel">
              Client: <span className="font-medium text-bone">{artistName ?? "This client"}</span>
            </p>
          ) : (
            <Field label="Client">
              <Select value={artistId} onValueChange={setArtistId}>
                <SelectTrigger>
                  <SelectValue placeholder={roster && roster.length === 0 ? "No clients yet" : "Choose a client"} />
                </SelectTrigger>
                <SelectContent>
                  {(roster ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Package">
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder={products && products.length === 0 ? "Create a package first" : "Choose a package"} />
              </SelectTrigger>
              <SelectContent>
                {(products ?? []).map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name} · {p.hours}h · {money(p.priceCents)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "in_person" ? "primary" : "ghost"}
              onClick={() => setMode("in_person")}
            >
              Paid in person
            </Button>
            <Button size="sm" variant={mode === "link" ? "primary" : "ghost"} onClick={() => setMode("link")}>
              Pay link
            </Button>
          </div>

          {mode === "in_person" ? (
            <>
              <Field label="How the client paid">
                <Select value={method} onValueChange={(m) => setMethod(m as Method)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Note (optional)">
                <Textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Receipt number, who took it" />
              </Field>
              <p className="text-xs text-steel/70">
                Record only money you have received. Your name is saved on the sale.
              </p>
            </>
          ) : link ? (
            <Field label="Pay link" hint="Send this to the client. The hours show once Stripe confirms the payment.">
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="secondary" onClick={() => void copy()}>
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
            </Field>
          ) : (
            <p className="text-xs text-steel/70">
              Makes a checkout link on your studio&apos;s Stripe account. Pulse does not send it; copy it to the client.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {link ? "Done" : "Cancel"}
          </Button>
          {mode === "in_person" ? (
            <Button variant="primary" disabled={busy || !ready} onClick={() => void record()}>
              <Check className="size-4" />
              Record payment
            </Button>
          ) : (
            !link && (
              <Button variant="primary" disabled={busy || !ready} onClick={() => void makeLink()}>
                <Link2 className="size-4" />
                Make pay link
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
