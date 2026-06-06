"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Plus, Search } from "lucide-react";
import { money } from "@/lib/format";
import { categoryMeta } from "@/components/studio/constants";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  EQUIPMENT_CATEGORIES,
  type EquipmentCategory,
} from "@/components/studio/constants";
import { PhotoUploader } from "./photo-uploader";
import { PhotoUpload } from "@/components/ui/photo-upload";

/** An equipment record in an editable shape. Pass to edit; omit to create. */
export type EditableEquipment = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  purchaseCents: number;
  currentValueCents: number;
  serialNumber?: string;
  condition?: string;
  notes?: string;
  /** Current display photo URL, when one is set. */
  photo?: string | null;
};

type FormState = {
  name: string;
  category: EquipmentCategory;
  purchase: string;
  currentValue: string;
  roomId: string;
  serialNumber: string;
  condition: string;
  notes: string;
};

/** Sentinel select value for "not installed - sits in storage". */
const STORAGE = "__storage__";

const BLANK: FormState = {
  name: "",
  category: "console",
  purchase: "",
  currentValue: "",
  roomId: STORAGE,
  serialNumber: "",
  condition: "",
  notes: "",
};

function toForm(item: EditableEquipment): FormState {
  return {
    name: item.name,
    category: item.category as EquipmentCategory,
    purchase: (item.purchaseCents / 100).toString(),
    currentValue: (item.currentValueCents / 100).toString(),
    roomId: STORAGE,
    serialNumber: item.serialNumber ?? "",
    condition: item.condition ?? "",
    notes: item.notes ?? "",
  };
}

/** Parse a dollar string into integer cents, or null when invalid. */
function dollarsToCents(value: string): number | null {
  const n = parseFloat(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/**
 * Add or edit an equipment item. Pass `item` to edit an existing record,
 * omit it to create a new one. Parent owns `open`. On create, an optional
 * install-in-room picker is shown; editing never moves the item.
 */
export function EquipmentDialog({
  item,
  open,
  onOpenChange,
}: {
  item?: EditableEquipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = item !== undefined;
  const createEquipment = useMutation(api.equipment.create);
  const updateEquipment = useMutation(api.equipment.update);
  const genPhotoUrl = useMutation(api.equipment.generateUploadUrl);
  const rooms = useQuery(api.rooms.bookable);

  const [form, setForm] = React.useState<FormState>(item ? toForm(item) : BLANK);
  const [submitting, setSubmitting] = React.useState(false);
  // Photo uploaded during the create flow (edit uses PhotoUploader + the item id).
  const [photoId, setPhotoId] = React.useState<string | null>(null);
  // Catalog photo URL prefilled when a catalog item with an image is picked.
  const [catalogPhotoUrl, setCatalogPhotoUrl] = React.useState<string | null>(null);
  // Gear-catalog search (create flow only).
  const [catalogQ, setCatalogQ] = React.useState("");
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const catalogResults = useQuery(
    api.equipment.searchCatalog,
    !isEdit && catalogQ.trim().length >= 1 ? { q: catalogQ, limit: 8 } : "skip",
  ) as
    | { id: string; brand: string; model: string; category: string; priceCents: number; note?: string; imageUrl?: string }[]
    | undefined;

  // Reset the form whenever the dialog re-opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setForm(item ? toForm(item) : BLANK);
      setPhotoId(null);
      setCatalogPhotoUrl(null);
      setCatalogQ("");
      setCatalogOpen(false);
    }
  }

  /** Prefill the form from a catalog selection (everything stays editable). */
  function pickCatalog(it: NonNullable<typeof catalogResults>[number]) {
    setForm((prev) => ({
      ...prev,
      name: `${it.brand} ${it.model}`,
      category: it.category as EquipmentCategory,
      purchase: (it.priceCents / 100).toString(),
    }));
    setCatalogPhotoUrl(it.imageUrl ?? null);
    setCatalogQ(`${it.brand} ${it.model}`);
    setCatalogOpen(false);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Give the equipment a name.");
      return;
    }
    const purchaseCents = dollarsToCents(form.purchase);
    const currentValueCents = dollarsToCents(form.currentValue);
    if (purchaseCents === null) {
      toast.error("Purchase value must be greater than zero.");
      return;
    }
    if (currentValueCents === null) {
      toast.error("Current value must be greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && item) {
        await updateEquipment({
          id: item._id,
          name,
          category: form.category,
          purchaseCents,
          currentValueCents,
          serialNumber: form.serialNumber.trim() || undefined,
          condition: form.condition.trim() || undefined,
          notes: form.notes.trim() || undefined,
        });
        toast.success(`${name} updated.`);
      } else {
        await createEquipment({
          name,
          category: form.category,
          purchaseCents,
          currentValueCents,
          installedInRoomId:
            form.roomId === STORAGE
              ? undefined
              : (form.roomId as Id<"rooms">),
          serialNumber: form.serialNumber.trim() || undefined,
          condition: form.condition.trim() || undefined,
          notes: form.notes.trim() || undefined,
          photoId: photoId ? (photoId as Id<"_storage">) : undefined,
          photoUrl: !photoId && catalogPhotoUrl ? catalogPhotoUrl : undefined,
        });
        toast.success(`${name} added to inventory.`);
      }
      onOpenChange(false);
    } catch {
      toast.error("Could not save the equipment. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit equipment" : "Add equipment"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `Update the asset details for ${item?.name}.`
              : "Track a new gear asset. Purchase and current value are required - install it into a room or leave it in storage."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            {!isEdit && (
              <Field
                label="Search gear catalog"
                hint="Pick a model to auto-fill name, category & price. Or just type your own below."
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ash-dim" />
                  <Input
                    value={catalogQ}
                    onChange={(e) => {
                      setCatalogQ(e.target.value);
                      setCatalogOpen(true);
                    }}
                    onFocus={() => setCatalogOpen(true)}
                    onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
                    placeholder="Focusrite Scarlett, Neumann U87, SSL…"
                    className="pl-9"
                    autoComplete="off"
                  />
                  {catalogOpen && catalogQ.trim().length >= 1 && (
                    <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-hairline bg-coal-2 shadow-elev-3">
                      {catalogResults === undefined ? (
                        <p className="px-3 py-2 text-xs text-ash-dim">Searching…</p>
                      ) : catalogResults.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-ash-dim">
                          No match. Type the full name below to add it as a custom item.
                        </p>
                      ) : (
                        catalogResults.map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickCatalog(it)}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-hairline/40"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-bone">
                                {it.brand} {it.model}
                              </span>
                              <span className="block truncate text-[0.6875rem] uppercase tracking-wide text-ash-dim">
                                {categoryMeta(it.category).label}
                                {it.note ? ` · ${it.note}` : ""}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-xs text-gold">
                              {money(it.priceCents)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </Field>
            )}

            <Field label="Name" htmlFor="equip-name">
              <Input
                id="equip-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="SSL 4000 G, Neumann U87…"
                autoFocus
                required
              />
            </Field>

            {/* Photo - edit uses the saved item id; create uploads now and
                attaches the storageId when the item is saved. */}
            {isEdit && item ? (
              <PhotoUploader equipmentId={item._id} photo={item.photo} />
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-ash">Photo</p>
                <PhotoUpload
                  photo={null}
                  generateUploadUrl={genPhotoUrl}
                  onStorageId={async (id) => setPhotoId(id)}
                  hint="Optional. Camera or library on mobile."
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" htmlFor="equip-category">
                <Select
                  value={form.category}
                  onValueChange={(v) => set("category", v as EquipmentCategory)}
                >
                  <SelectTrigger id="equip-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EQUIPMENT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {!isEdit && (
                <Field
                  label="Location"
                  htmlFor="equip-room"
                  hint="Install into a room, or leave in storage."
                >
                  <Select
                    value={form.roomId}
                    onValueChange={(v) => set("roomId", v)}
                  >
                    <SelectTrigger id="equip-room">
                      <SelectValue
                        placeholder={rooms ? "Storage" : "Loading rooms…"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={STORAGE}>Storage</SelectItem>
                      {(rooms ?? []).map((r) => (
                        <SelectItem key={r._id} value={r._id}>
                          {r.name}
                          {r.roomType ? ` · ${r.roomType}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Purchase value"
                htmlFor="equip-purchase"
                hint="In dollars. What it cost new."
              >
                <Input
                  id="equip-purchase"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.purchase}
                  onChange={(e) => set("purchase", e.target.value)}
                  placeholder="48000"
                  autoComplete="off"
                  required
                />
              </Field>
              <Field
                label="Current value"
                htmlFor="equip-current"
                hint="In dollars. What it is worth now."
              >
                <Input
                  id="equip-current"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.currentValue}
                  onChange={(e) => set("currentValue", e.target.value)}
                  placeholder="32000"
                  autoComplete="off"
                  required
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Serial number" htmlFor="equip-serial">
                <Input
                  id="equip-serial"
                  value={form.serialNumber}
                  onChange={(e) => set("serialNumber", e.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                />
              </Field>
              <Field label="Condition" htmlFor="equip-condition">
                <Input
                  id="equip-condition"
                  value={form.condition}
                  onChange={(e) => set("condition", e.target.value)}
                  placeholder="Excellent, serviced…"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field label="Notes" htmlFor="equip-notes">
              <Textarea
                id="equip-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Anything worth noting about this item…"
                rows={3}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {isEdit ? <Check className="size-4" /> : <Plus className="size-4" />}
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Add to inventory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
