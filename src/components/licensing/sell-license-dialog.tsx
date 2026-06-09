"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/feedback";
import { meta, SONG_STAGE, LICENSE_TIER } from "@/lib/labels";
import type { LicenseTier, RosterArtist, SongOption } from "./types";

const TIERS: LicenseTier[] = ["mp3", "wav", "trackout", "exclusive"];
const NO_ARTIST = "__none__";

/** Sell a beat license - song, buyer, optional roster artist, tier and terms. */
export function SellLicenseDialog() {
  const songs = useQuery(api.songs.picker, {}) as SongOption[] | undefined;
  const roster = useQuery(api.artists.roster) as RosterArtist[] | undefined;
  const sellLicense = useMutation(api.licensing.sellLicense);

  const [open, setOpen] = useState(false);
  const [songId, setSongId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerArtistId, setBuyerArtistId] = useState<string>(NO_ARTIST);
  const [tier, setTier] = useState<LicenseTier>("mp3");
  const [price, setPrice] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [streamCap, setStreamCap] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isExclusive = tier === "exclusive";

  function reset() {
    setSongId("");
    setBuyerName("");
    setBuyerArtistId(NO_ARTIST);
    setTier("mp3");
    setPrice("");
    setTermMonths("");
    setStreamCap("");
  }

  async function handleSubmit() {
    if (!songId) return toast.error("Pick a beat to license.");
    if (!buyerName.trim()) return toast.error("Add the buyer's name.");

    const priceNumber = Number(price);
    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      return toast.error("Enter a valid price.");
    }
    const termNumber = termMonths.trim() === "" ? undefined : Number(termMonths);
    if (termNumber !== undefined && (!Number.isInteger(termNumber) || termNumber <= 0)) {
      return toast.error("Term must be a whole number of months.");
    }
    const capNumber = streamCap.trim() === "" ? undefined : Number(streamCap);
    if (capNumber !== undefined && (!Number.isInteger(capNumber) || capNumber <= 0)) {
      return toast.error("Stream cap must be a whole number.");
    }

    setSubmitting(true);
    try {
      await sellLicense({
        songId: songId as Id<"songs">,
        buyerName: buyerName.trim(),
        buyerArtistId:
          buyerArtistId === NO_ARTIST
            ? undefined
            : (buyerArtistId as Id<"artists">),
        tier,
        priceCents: Math.round(priceNumber * 100),
        termMonths: termNumber,
        streamCap: capNumber,
      });
      toast.success(
        isExclusive
          ? "Exclusive sold - other licenses on this beat deactivated."
          : "License sold.",
      );
      setOpen(false);
      reset();
    } catch {
      toast.error("Could not record the license. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Sell a license
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Sell a beat license</DialogTitle>
          <DialogDescription>
            Record a license sale against a beat. Selling an exclusive clears
            every other active license on that beat.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Beat">
            <Select value={songId} onValueChange={setSongId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a beat…" />
              </SelectTrigger>
              <SelectContent>
                {songs === undefined ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-steel/70">
                    <Spinner /> Loading catalog…
                  </div>
                ) : songs.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-steel/70">No songs yet.</div>
                ) : (
                  songs.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.title} · {meta(SONG_STAGE, s.stage).label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Buyer" htmlFor="license-buyer">
              <Input
                id="license-buyer"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="e.g. Dax Holloway"
              />
            </Field>
            <Field
              label="Client"
              hint="Optional - link the buyer to an existing client."
            >
              <Select value={buyerArtistId} onValueChange={setBuyerArtistId}>
                <SelectTrigger>
                  <SelectValue placeholder="Not a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ARTIST}>Not a client</SelectItem>
                  {(roster ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tier">
              <Select value={tier} onValueChange={(v) => setTier(v as LicenseTier)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {meta(LICENSE_TIER, t).label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Price" htmlFor="license-price" hint="In dollars.">
              <Input
                id="license-price"
                type="number"
                min={0}
                step={5}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="e.g. 49"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Term"
              htmlFor="license-term"
              hint="Optional - license length in months."
            >
              <Input
                id="license-term"
                type="number"
                min={1}
                step={1}
                value={termMonths}
                onChange={(e) => setTermMonths(e.target.value)}
                placeholder="e.g. 24"
              />
            </Field>
            <Field
              label="Stream cap"
              htmlFor="license-cap"
              hint="Optional - max streams allowed."
            >
              <Input
                id="license-cap"
                type="number"
                min={1}
                step={1000}
                value={streamCap}
                onChange={(e) => setStreamCap(e.target.value)}
                placeholder="e.g. 100000"
              />
            </Field>
          </div>

          {isExclusive && (
            <div className="flex items-start gap-2.5 rounded-md border border-caution/40 bg-caution/10 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" />
              <p className="text-xs leading-relaxed text-caution">
                Heads up - selling an exclusive automatically deactivates every
                other active license on this beat. This cannot be undone from
                here.
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Spinner className="text-gold-ink" /> Recording…
              </>
            ) : (
              "Sell license"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
