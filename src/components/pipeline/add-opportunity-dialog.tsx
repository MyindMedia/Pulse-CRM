"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";

const SERVICE_TYPES = [
  "recording",
  "mixing",
  "mastering",
  "production",
  "consultation",
  "rehearsal",
  "writing",
] as const;

const SOURCES = ["Referral", "Website", "Instagram", "Repeat client", "Walk-in", "Other"];

/** Create-opportunity modal. Submits to opportunities.create. */
export function AddOpportunityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const roster = useQuery(api.artists.roster);
  const create = useMutation(api.opportunities.create);

  const [title, setTitle] = useState("");
  const [artistId, setArtistId] = useState("");
  const [serviceType, setServiceType] = useState<string>("recording");
  const [value, setValue] = useState("");
  const [source, setSource] = useState<string>("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle("");
    setArtistId("");
    setServiceType("recording");
    setValue("");
    setSource("");
  }

  const valueCents = Math.round((parseFloat(value) || 0) * 100);
  const canSubmit = title.trim().length > 0 && artistId !== "" && valueCents > 0 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await create({
        title: title.trim(),
        artistId: artistId as Id<"artists">,
        serviceType: serviceType as
          | "recording"
          | "mixing"
          | "mastering"
          | "production"
          | "consultation"
          | "rehearsal"
          | "writing",
        valueCents,
        source: source || undefined,
      });
      toast.success("Opportunity added to the pipeline");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Could not create the opportunity");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
          <DialogDescription>Add a deal to the inquiry stage of the pipeline.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <Field label="Deal title" htmlFor="opp-title">
            <Input
              id="opp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="EP mix package - 4 songs"
              autoFocus
            />
          </Field>

          <Field label="Artist">
            <Select value={artistId} onValueChange={setArtistId}>
              <SelectTrigger>
                <SelectValue placeholder={roster ? "Select an artist" : "Loading roster…"} />
              </SelectTrigger>
              <SelectContent>
                {(roster ?? []).map((a) => (
                  <SelectItem key={a._id} value={a._id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Service type">
              <Select value={serviceType} onValueChange={setServiceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Estimated value (USD)" htmlFor="opp-value">
              <Input
                id="opp-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="2500"
              />
            </Field>
          </div>

          <Field label="Source" hint="Where the lead came from - optional.">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue placeholder="Select a source" />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving && <Spinner className="text-gold-ink" />}
            {saving ? "Adding…" : "Add opportunity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
