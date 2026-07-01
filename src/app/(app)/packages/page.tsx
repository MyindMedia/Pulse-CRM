"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Package, Plus, Pencil, Trash2, Clock3, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money, shortDate } from "@/lib/format";
import { ProductDialog, type PackageTarget } from "@/components/packages/product-dialog";

export default function PackagesPage() {
  const products = useQuery(api.packages.list, {});
  const credits = useQuery(api.packages.soldCredits, {});
  const update = useMutation(api.packages.update);
  const remove = useMutation(api.packages.remove);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<PackageTarget | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(p: PackageTarget) {
    setEditing(p);
    setDialogOpen(true);
  }

  async function toggleActive(p: PackageTarget) {
    setBusy(p._id);
    try {
      await update({ id: p._id, active: !p.active });
      toast.success(p.active ? "Package hidden." : "Package active.");
    } catch {
      toast.error("Could not update. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function removeProduct(id: Id<"packageProducts">) {
    setBusy(id);
    try {
      await remove({ id });
      toast.success("Package removed. Sold credits are unaffected.");
    } catch {
      toast.error("Could not remove. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Bookings"
        title="Packages"
        description="Prepaid hour blocks - sell studio time up front at a discount. Cash comes forward and the client is locked in; hours draw down on their future sessions."
        actions={
          <Button onClick={openNew}>
            <Plus className="size-4" />
            New package
          </Button>
        }
      />

      {/* Products offered */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-gold" />
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            Packages you offer
          </h2>
          {products && <Badge tone="neutral">{products.length}</Badge>}
        </div>

        {products === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No packages yet"
            description="Create a block like '10 hours, 15% off' to pull revenue forward and lock clients in."
          />
        ) : (
          <div className="space-y-2">
            {products.map((p) => {
              const perHour = p.hours > 0 ? Math.round(p.priceCents / p.hours) : 0;
              return (
                <div
                  key={p._id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite/50 bg-coal p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate font-grotesk font-medium text-bone">
                      {p.name}
                      {!p.active && <Badge tone="neutral">Hidden</Badge>}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-steel/70">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3" />
                        {p.hours}h
                      </span>
                      <span className="text-steel/40">·</span>
                      <span className="font-meta font-semibold text-gold-bright">
                        {money(p.priceCents)}
                      </span>
                      <span className="text-steel/40">·</span>
                      {money(perHour)}/hr
                    </p>
                    {p.description && (
                      <p className="mt-1 truncate text-xs text-steel/60">{p.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p._id}
                    onClick={() => void toggleActive(p)}
                  >
                    {p.active ? "Hide" : "Show"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === p._id}
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p._id}
                    onClick={() => void removeProduct(p._id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Sold credits */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-gold" />
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            Hours on the books
          </h2>
          {credits && <Badge tone="neutral">{credits.length}</Badge>}
        </div>

        {credits === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : credits.length === 0 ? (
          <p className="rounded-lg border border-graphite/50 bg-coal p-4 text-sm text-steel">
            No packages sold yet. Once a client buys a block it shows here with
            their remaining hours.
          </p>
        ) : (
          <div className="space-y-2">
            {credits.map((c) => {
              const pct = c.hoursTotal > 0 ? (c.hoursRemaining / c.hoursTotal) * 100 : 0;
              const tone =
                c.status === "active" ? "positive" : c.status === "depleted" ? "neutral" : "caution";
              return (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-graphite/50 bg-coal p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-grotesk font-medium text-bone">{c.artistName}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-steel/70">
                      {c.name}
                      <span className="text-steel/40">·</span>
                      {money(c.priceCents)}
                      <span className="text-steel/40">·</span>
                      bought {shortDate(c.purchasedAt)}
                    </p>
                    <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-coal-3">
                      <div
                        className="h-full rounded-full bg-gold"
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-meta text-sm font-semibold text-bone">
                      {c.hoursRemaining}
                      <span className="text-steel/60"> / {c.hoursTotal}h left</span>
                    </p>
                    <Badge tone={tone} className="mt-1 capitalize">
                      {c.status}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ProductDialog product={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
