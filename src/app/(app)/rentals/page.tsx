"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Tags, Plus, Check, Search, CalendarClock, Music4, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { EquipmentDialog } from "@/components/inventory/equipment-dialog";

/** Dollars string -> integer cents (>= 0), or null when blank/invalid. */
function dollarsToCents(value: string): number | null {
  const n = parseFloat(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function Thumb({ photo, name }: { photo: string | null; name: string }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" className="size-11 shrink-0 rounded-md object-cover" draggable={false} />;
  }
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-md bg-coal-3 text-steel" aria-label={name}>
      <Music4 className="size-5" />
    </span>
  );
}

export default function RentalsPage() {
  const board = useQuery(api.equipment.rentableBoard);
  const setRentable = useMutation(api.equipment.setRentable);

  const [addOpen, setAddOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  // Per-item price drafts (dollars), keyed by equipment id.
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);

  function draftFor(id: string, fallbackCents: number) {
    return drafts[id] ?? (fallbackCents ? (fallbackCents / 100).toString() : "");
  }

  async function savePrice(id: Id<"equipment">, value: string) {
    const cents = dollarsToCents(value);
    if (cents === null) {
      toast.error("Enter a rental price (0 or more).");
      return;
    }
    setBusy(id);
    try {
      await setRentable({ id, rentable: true, rentalPriceCents: cents });
      toast.success("Rental price saved.");
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
    } catch {
      toast.error("Could not save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addFromInventory(id: Id<"equipment">, value: string) {
    const cents = dollarsToCents(value);
    if (cents === null) {
      toast.error("Set a rental price first.");
      return;
    }
    setBusy(id);
    try {
      await setRentable({ id, rentable: true, rentalPriceCents: cents });
      toast.success("Added to your rentals.");
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
    } catch {
      toast.error("Could not add. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function removeRental(id: Id<"equipment">) {
    setBusy(id);
    try {
      await setRentable({ id, rentable: false });
      toast.success("Removed from rentals. Still in your inventory.");
    } catch {
      toast.error("Could not remove. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const candidates = React.useMemo(() => {
    const list = board?.candidates ?? [];
    const q = search.trim().toLowerCase();
    return q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.category.includes(q)) : list;
  }, [board, search]);

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Bookings"
        title="Rentable gear"
        description="Premium gear clients can add a-la-carte when they book. Set a per-session price; a single unit can never be double-booked. Everything here lives in your inventory and stays in sync."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add new gear
          </Button>
        }
      />

      {board === undefined ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* Offered as add-ons */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Tags className="size-4 text-gold" />
              <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
                Offered as add-ons
              </h2>
              <Badge tone="neutral">{board.rentable.length}</Badge>
            </div>

            {board.rentable.length === 0 ? (
              <EmptyState
                icon={Tags}
                title="No rentable gear yet"
                description="Add gear from your inventory below, or add a brand-new item, to offer it on your booking page."
              />
            ) : (
              <div className="space-y-2">
                {board.rentable.map((item) => {
                  const value = draftFor(item._id, item.rentalPriceCents);
                  const dirty = drafts[item._id] !== undefined;
                  return (
                    <div
                      key={item._id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite/50 bg-coal p-3"
                    >
                      <Thumb photo={item.photo} name={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-grotesk font-medium text-bone">{item.name}</p>
                        <p className="flex flex-wrap items-center gap-2 text-xs capitalize text-steel/70">
                          {item.category.replace(/_/g, " ")}
                          <span className="text-steel/40">·</span>
                          {item.quantity} unit{item.quantity === 1 ? "" : "s"}
                          {item.upcomingRentals > 0 && (
                            <Badge tone="gold" className="ml-1">
                              <CalendarClock className="mr-1 size-3" />
                              {item.upcomingRentals} upcoming
                            </Badge>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-steel">$</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={value}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item._id]: e.target.value }))}
                          className="w-24"
                          aria-label={`${item.name} rental price`}
                        />
                        <span className="text-xs text-steel/60">/session</span>
                      </div>
                      <Button
                        size="sm"
                        variant={dirty ? "primary" : "secondary"}
                        disabled={busy === item._id || !dirty}
                        onClick={() => void savePrice(item._id, value)}
                      >
                        <Check className="size-4" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === item._id}
                        onClick={() => void removeRental(item._id)}
                      >
                        <X className="size-4" />
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add from inventory */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="size-4 text-gold" />
              <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
                Add from inventory
              </h2>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your inventory…"
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {candidates.length === 0 ? (
              <p className="rounded-lg border border-graphite/50 bg-coal p-4 text-sm text-steel">
                {board.candidates.length === 0
                  ? "Every item in your inventory is already rentable. Add new gear up top."
                  : "No inventory items match your search."}
              </p>
            ) : (
              <div className="space-y-2">
                {candidates.map((item) => {
                  const value = drafts[item._id] ?? "";
                  return (
                    <div
                      key={item._id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite/50 bg-coal-2/60 p-3"
                    >
                      <Thumb photo={item.photo} name={item.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-grotesk font-medium text-bone">{item.name}</p>
                        <p className="text-xs capitalize text-steel/70">
                          {item.category.replace(/_/g, " ")} · {item.quantity} unit
                          {item.quantity === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-steel">$</span>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={value}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item._id]: e.target.value }))}
                          placeholder="75"
                          className="w-24"
                          aria-label={`${item.name} rental price`}
                        />
                        <span className="text-xs text-steel/60">/session</span>
                      </div>
                      <Button
                        size="sm"
                        disabled={busy === item._id}
                        onClick={() => void addFromInventory(item._id, value)}
                      >
                        <Plus className="size-4" />
                        Make rentable
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <EquipmentDialog open={addOpen} onOpenChange={setAddOpen} defaultRentable />
    </div>
  );
}
