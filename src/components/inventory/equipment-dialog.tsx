"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Plus, Search, ChevronDown } from "lucide-react";
import { money } from "@/lib/format";
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
  assetClass,
  type EquipmentCategory,
} from "@/components/studio/constants";
import { PhotoUploader } from "./photo-uploader";
import { AssetDocuments } from "./asset-documents";
import { PhotoUpload } from "@/components/ui/photo-upload";

/** An equipment record in an editable shape. Pass to edit; omit to create. */
export type EditableEquipment = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  quantity?: number;
  purchaseCents: number;
  currentValueCents: number;
  serialNumber?: string;
  condition?: string;
  notes?: string;
  rentable?: boolean;
  rentalPriceCents?: number;
  /** Current display photo URL, when one is set. */
  photo?: string | null;
};

type FormState = {
  name: string;
  category: EquipmentCategory;
  quantity: string;
  purchase: string;
  currentValue: string;
  roomId: string;
  serialNumber: string;
  condition: string;
  notes: string;
  rentable: boolean;
  rentalPrice: string;
};

/** Sentinel select value for "not installed - sits in storage". */
const STORAGE = "__storage__";

const BLANK: FormState = {
  name: "",
  category: "console",
  quantity: "1",
  purchase: "",
  currentValue: "",
  roomId: STORAGE,
  serialNumber: "",
  condition: "",
  notes: "",
  rentable: false,
  rentalPrice: "",
};

function toForm(item: EditableEquipment): FormState {
  return {
    name: item.name,
    category: item.category as EquipmentCategory,
    quantity: item.quantity && item.quantity > 0 ? String(item.quantity) : "1",
    purchase: (item.purchaseCents / 100).toString(),
    currentValue: (item.currentValueCents / 100).toString(),
    roomId: STORAGE,
    serialNumber: item.serialNumber ?? "",
    condition: item.condition ?? "",
    notes: item.notes ?? "",
    rentable: item.rentable ?? false,
    rentalPrice: item.rentalPriceCents ? (item.rentalPriceCents / 100).toString() : "",
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
 * `defaultRentable` pre-arms the booking-add-on toggle (used when adding from
 * the Rentals page) - the item still lands in the one shared inventory.
 */
export function EquipmentDialog({
  item,
  open,
  onOpenChange,
  defaultRentable,
}: {
  item?: EditableEquipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRentable?: boolean;
}) {
  const blank: FormState = { ...BLANK, rentable: defaultRentable ?? false };
  const isEdit = item !== undefined;
  const createEquipment = useMutation(api.equipment.create);
  const updateEquipment = useMutation(api.equipment.update);
  const genPhotoUrl = useMutation(api.equipment.generateUploadUrl);
  const rooms = useQuery(api.rooms.bookable);

  const [form, setForm] = React.useState<FormState>(item ? toForm(item) : blank);
  const [submitting, setSubmitting] = React.useState(false);
  // Photo uploaded during the create flow (edit uses PhotoUploader + the item id).
  const [photoId, setPhotoId] = React.useState<string | null>(null);
  // Catalog photo prefilled when a catalog item with an image is picked.
  const [catalogPhotoUrl, setCatalogPhotoUrl] = React.useState<string | null>(null);
  const [catalogPhotoCredit, setCatalogPhotoCredit] = React.useState<string | null>(null);
  // Gear-catalog search (create flow only).
  const [catalogQ, setCatalogQ] = React.useState("");
  const [catalogOpen, setCatalogOpen] = React.useState(false);
  const catalogResults = useQuery(
    api.equipment.searchCatalog,
    // Open => fetch. Empty query returns the full catalog to browse by type;
    // a typed query returns ranked matches.
    !isEdit && catalogOpen ? { q: catalogQ, limit: catalogQ.trim() ? 20 : 300 } : "skip",
  ) as
    | {
        id: string; brand: string; model: string; category: string;
        priceCents: number; note?: string; imageUrl?: string; imageCredit?: string;
      }[]
    | undefined;

  // Group results by category (type), in the canonical category order.
  const groupedCatalog = React.useMemo(() => {
    const byCat = new Map<string, NonNullable<typeof catalogResults>>();
    for (const it of catalogResults ?? []) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it);
      byCat.set(it.category, arr);
    }
    return EQUIPMENT_CATEGORIES
      .map((c) => ({ category: c.value as string, label: c.plural, items: byCat.get(c.value) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [catalogResults]);

  // Reset the form whenever the dialog re-opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setForm(item ? toForm(item) : blank);
      setPhotoId(null);
      setCatalogPhotoUrl(null);
      setCatalogPhotoCredit(null);
      setCatalogQ("");
      setCatalogOpen(false);
    }
  }

  /** Prefill ALL sensible fields from a catalog selection (everything stays
   *  editable). Serial is per-unit so it's left blank. New gear's current value
   *  defaults to its purchase price. */
  function pickCatalog(it: NonNullable<typeof catalogResults>[number]) {
    const dollars = (it.priceCents / 100).toString();
    setForm((prev) => ({
      ...prev,
      name: `${it.brand} ${it.model}`,
      category: it.category as EquipmentCategory,
      purchase: dollars,
      currentValue: dollars,
      condition: prev.condition.trim() || "New",
      notes: prev.notes.trim() || (it.note ?? ""),
    }));
    setCatalogPhotoUrl(it.imageUrl ?? null);
    setCatalogPhotoCredit(it.imageCredit ?? null);
    setCatalogQ(`${it.brand} ${it.model}`);
    setCatalogOpen(false);
  }

  /** Use the typed text as a custom item (not in the catalog). */
  function applyCustomItem() {
    const name = catalogQ.trim();
    if (!name) return;
    setForm((prev) => ({ ...prev, name }));
    setCatalogPhotoUrl(null);
    setCatalogPhotoCredit(null);
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
    // Rental price is only meaningful when the item is offered as an add-on.
    const rentalPriceCents = form.rentable
      ? Math.max(0, Math.round((parseFloat(form.rentalPrice) || 0) * 100))
      : 0;
    setSubmitting(true);
    try {
      if (isEdit && item) {
        await updateEquipment({
          id: item._id,
          name,
          category: form.category,
          quantity: Math.max(1, parseInt(form.quantity, 10) || 1),
          purchaseCents,
          currentValueCents,
          serialNumber: form.serialNumber.trim() || undefined,
          condition: form.condition.trim() || undefined,
          notes: form.notes.trim() || undefined,
          rentable: form.rentable,
          rentalPriceCents,
        });
        toast.success(`${name} updated.`);
      } else {
        await createEquipment({
          name,
          category: form.category,
          quantity: Math.max(1, parseInt(form.quantity, 10) || 1),
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
          rentable: form.rentable || undefined,
          rentalPriceCents: form.rentable ? rentalPriceCents : undefined,
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
                label="Gear catalog"
                hint="Pick a model to auto-fill name, category & price - or add a custom item."
              >
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
                  <Input
                    value={catalogQ}
                    onChange={(e) => {
                      setCatalogQ(e.target.value);
                      setCatalogOpen(true);
                    }}
                    onFocus={() => setCatalogOpen(true)}
                    onBlur={() => setTimeout(() => setCatalogOpen(false), 150)}
                    placeholder="Search gear, or type a custom name…"
                    className="pl-9 pr-9"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={catalogOpen}
                  />
                  <ChevronDown
                    className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-steel/70"
                  />
                  {catalogOpen && (
                    <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-graphite/50 bg-coal-2 shadow-elev-3">
                      {/* Custom-item entry - always available when text is typed. */}
                      {catalogQ.trim().length >= 1 && (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={applyCustomItem}
                          className="flex w-full items-center gap-2 border-b border-graphite/60 px-3 py-2 text-left hover:bg-hairline/40"
                        >
                          <Plus className="size-4 shrink-0 text-gold" />
                          <span className="min-w-0 flex-1 truncate text-sm text-bone">
                            Add <span className="text-gold">&ldquo;{catalogQ.trim()}&rdquo;</span> as a custom item
                          </span>
                        </button>
                      )}
                      {catalogResults === undefined ? (
                        <p className="px-3 py-2 text-xs text-steel/70">Loading…</p>
                      ) : catalogResults.length === 0 ? (
                        catalogQ.trim().length >= 1 ? (
                          <p className="px-3 py-2 text-xs text-steel/70">
                            No catalog match - use the custom-item option above.
                          </p>
                        ) : (
                          <p className="px-3 py-2 text-xs text-steel/70">Start typing to search the catalog.</p>
                        )
                      ) : (
                        groupedCatalog.map((group) => (
                          <div key={group.category}>
                            <p className="sticky top-0 z-10 bg-obsidian px-3 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-steel/70">
                              {group.label}
                            </p>
                            {group.items.map((it) => (
                              <button
                                key={it.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickCatalog(it)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hairline/40"
                              >
                                {it.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={it.imageUrl}
                                    alt=""
                                    className="size-9 shrink-0 rounded border border-graphite/50 object-cover"
                                    loading="lazy"
                                  />
                                ) : null}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-bone">
                                    {it.brand} {it.model}
                                  </span>
                                  {it.note ? (
                                    <span className="block truncate text-[0.6875rem] text-steel/70">
                                      {it.note}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 font-meta text-xs text-gold">
                                  {money(it.priceCents)}
                                </span>
                              </button>
                            ))}
                          </div>
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
              <>
                <PhotoUploader equipmentId={item._id} photo={item.photo} />
                <AssetDocuments kind="equipment" refId={item._id} />
              </>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-steel">Photo</p>
                {catalogPhotoUrl && !photoId ? (
                  <div className="flex items-start gap-3 rounded-md border border-graphite/50 bg-coal-2 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={catalogPhotoUrl}
                      alt="Catalog"
                      className="size-16 shrink-0 rounded border border-graphite/50 object-cover"
                    />
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="text-steel">Using the catalog photo.</p>
                      {catalogPhotoCredit ? (
                        <p className="mt-0.5 text-[0.6875rem] text-steel/70">{catalogPhotoCredit}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogPhotoUrl(null);
                          setCatalogPhotoCredit(null);
                        }}
                        className="mt-1 text-[0.6875rem] font-medium text-gold hover:underline"
                      >
                        Remove / upload my own
                      </button>
                    </div>
                  </div>
                ) : (
                  <PhotoUpload
                    photo={null}
                    generateUploadUrl={genPhotoUrl}
                    onStorageId={async (id) => setPhotoId(id)}
                    hint="Optional. Camera or library on mobile."
                  />
                )}
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

            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Quantity"
                htmlFor="equip-qty"
                hint="How many you own"
              >
                <Input
                  id="equip-qty"
                  type="number"
                  min={1}
                  step="1"
                  inputMode="numeric"
                  value={form.quantity}
                  onChange={(e) => set("quantity", e.target.value)}
                  placeholder="1"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Purchase value"
                htmlFor="equip-purchase"
                hint="Per unit, cost new"
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
                hint="Per unit, worth now"
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

            {/* Rental add-on: offer this item on the public booking page.
                Gear only - never furniture / acoustic / decor / cable. */}
            {assetClass(form.category) === "gear" && (
            <div className="space-y-3 rounded-md border border-graphite/50 bg-coal-2 p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={form.rentable}
                  onChange={(e) => set("rentable", e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-gold"
                />
                <span>
                  <span className="block text-sm font-medium text-bone">
                    Offer as a booking add-on
                  </span>
                  <span className="block text-xs text-steel/70">
                    Clients can rent this on your booking page for a per-session price. A single
                    unit can never be double-booked across overlapping sessions.
                  </span>
                </span>
              </label>
              {form.rentable && (
                <Field
                  label="Rental price per session"
                  htmlFor="equip-rental"
                  hint="Added to the client's session total and deposit."
                >
                  <Input
                    id="equip-rental"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={form.rentalPrice}
                    onChange={(e) => set("rentalPrice", e.target.value)}
                    placeholder="75"
                    autoComplete="off"
                  />
                </Field>
              )}
            </div>
            )}
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
