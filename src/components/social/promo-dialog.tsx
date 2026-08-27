"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
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
import { Field, Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "./schedule-math";

const WEEK = 7 * 86_400_000;

/** Create or edit a promo code. Passing `promo` switches this into edit
 *  mode (calls `promos.update` instead of `promos.create`) and pre-fills
 *  the form from it. The code is always normalized uppercase server-side
 *  (`normalizeCode`, convex/promos.ts:7); the field mirrors that live so
 *  what the owner sees while typing already matches what gets saved. */
export function PromoDialog({
  open,
  onOpenChange,
  promo,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promo?: Doc<"promos"> | null;
  timezone: string;
}) {
  const rooms = useQuery(api.rooms.list, {});
  const create = useMutation(api.promos.create);
  const update = useMutation(api.promos.update);

  const [code, setCode] = React.useState("");
  const [pct, setPct] = React.useState("10");
  const [label, setLabel] = React.useState("");
  const [starts, setStarts] = React.useState("");
  const [ends, setEnds] = React.useState("");
  const [roomId, setRoomId] = React.useState<Id<"rooms"> | undefined>(undefined);
  const [maxRedemptions, setMaxRedemptions] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Reset the form only when the dialog opens (or which promo it opened for
  // changes), not on every render - a background revalidation of `promo`
  // while the dialog is open must never clobber what the owner is typing.
  React.useEffect(() => {
    if (!open) return;
    if (promo) {
      setCode(promo.code);
      setPct(String(promo.pct));
      setLabel(promo.label ?? "");
      setStarts(toDatetimeLocalValue(promo.startsAt, timezone));
      setEnds(toDatetimeLocalValue(promo.endsAt, timezone));
      setRoomId(promo.roomId);
      setMaxRedemptions(promo.maxRedemptions !== undefined ? String(promo.maxRedemptions) : "");
    } else {
      const now = Date.now();
      setCode("");
      setPct("10");
      setLabel("");
      setStarts(toDatetimeLocalValue(now, timezone));
      setEnds(toDatetimeLocalValue(now + WEEK, timezone));
      setRoomId(undefined);
      setMaxRedemptions("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, promo?._id]);

  async function handleSave() {
    const startsAt = fromDatetimeLocalValue(starts, timezone);
    const endsAt = fromDatetimeLocalValue(ends, timezone);
    if (startsAt === null || endsAt === null) {
      toast.error("Enter both a start and an end time.");
      return;
    }
    const pctNum = Number(pct);
    if (!Number.isFinite(pctNum)) {
      toast.error("Enter a discount percent.");
      return;
    }
    const maxTrimmed = maxRedemptions.trim();
    let maxNum: number | undefined;
    if (maxTrimmed) {
      maxNum = Number(maxTrimmed);
      if (!Number.isFinite(maxNum) || maxNum <= 0) {
        toast.error("Max redemptions has to be a positive number.");
        return;
      }
    }
    const args = {
      code,
      pct: pctNum,
      label: label.trim() || undefined,
      startsAt,
      endsAt,
      roomId,
      maxRedemptions: maxNum,
    };
    setSaving(true);
    try {
      if (promo) {
        await update({ id: promo._id, ...args });
        toast.success("Promo updated.");
      } else {
        await create(args);
        toast.success("Promo created.");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save this promo. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{promo ? "Edit promo" : "New promo"}</DialogTitle>
          <DialogDescription>Codes are uppercase. A promo ends at the exact time you set.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER25"
              disabled={saving}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount percent">
              <Input
                type="number"
                min={1}
                max={90}
                value={pct}
                onChange={(e) => setPct(e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="Label (optional)">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Summer rate cut"
                disabled={saving}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" hint={`Times shown in ${timezone}`}>
              <Input
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
                disabled={saving}
              />
            </Field>
            <Field label="Ends">
              <Input
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
                disabled={saving}
              />
            </Field>
          </div>
          <Field label="Room">
            <Select
              value={roomId ?? "none"}
              onValueChange={(v) => setRoomId(v === "none" ? undefined : (v as Id<"rooms">))}
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue placeholder="All rooms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All rooms</SelectItem>
                {(rooms ?? []).map((r) => (
                  <SelectItem key={r._id} value={r._id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Max redemptions (optional)" hint="Leave blank for no cap.">
            <Input
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="No cap"
              disabled={saving}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : promo ? "Save changes" : "Create promo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
