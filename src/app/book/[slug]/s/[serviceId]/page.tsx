"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowLeft, DoorClosed, Music4, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { PublicTheme } from "@/components/shell/public-theme";
import { GearGallery } from "@/components/book/gear-gallery";
import {
  AvailabilityPicker,
  type SlotSelection,
} from "@/components/book/availability-picker";
import {
  BookingForm,
  emptyBookingForm,
  type BookingFormValues,
} from "@/components/book/booking-form";
import { cn } from "@/lib/utils";
import { useTrackBookingStep, visitorKey } from "@/lib/use-booking-funnel";

/* ============================================================
   Booking one SERVICE.

   The room-first page asks "which space?", which only works for a studio
   whose spaces are its products. This page asks "what are we doing?" - the
   room the service consumes is resolved on the server and never named here,
   because a client booking a podcast does not need to know which four walls
   it happens in.
   ============================================================ */

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ServiceBookingPage() {
  return (
    <React.Suspense fallback={<ServiceSkeleton />}>
      <ServiceBookingView />
    </React.Suspense>
  );
}

function ServiceBookingView() {
  const params = useParams<{ slug: string; serviceId: string }>();
  const slug = params?.slug ?? "";
  const serviceId = (params?.serviceId ?? "") as Id<"bookableServices">;
  const router = useRouter();
  const searchParams = useSearchParams();
  const refFromLink = searchParams.get("ref") ?? undefined;

  const service = useQuery(api.booking.service, { serviceId });
  const createBooking = useMutation(api.booking.createBooking);

  const [selection, setSelection] = React.useState<SlotSelection | null>(null);
  const [form, setForm] = React.useState<BookingFormValues>(emptyBookingForm);
  const [chosenAddOns, setChosenAddOns] = React.useState<Id<"feeTemplates">[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSelection = React.useCallback((s: SlotSelection | null) => setSelection(s), []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim());
  const formValid = form.clientName.trim().length > 1 && emailValid;

  /* Both funnel hooks sit above every early return. React counts hooks by
     position, and a hook that appears only after the data loads changes that
     count between renders - which is what took every room booking link down
     with React #310. `enabled` is how a hook is made conditional. */
  useTrackBookingStep(slug, "room", { enabled: Boolean(service) });
  useTrackBookingStep(slug, "checkout", {
    enabled: Boolean(service && selection && formValid),
  });

  if (service === undefined) return <ServiceSkeleton />;

  if (service === null) {
    return (
      <div className="mx-auto max-w-md py-10">
        <EmptyState
          icon={DoorClosed}
          title="Not available"
          description="This service is no longer offered, or the link is invalid."
          action={
            <Button asChild variant="outline">
              <Link href={`/book/${slug}`}>Back to studio</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const svc = service;
  const flat = svc.pricingMode === "flat";
  const addOnCents = svc.addOns
    .filter((a) => chosenAddOns.includes(a._id))
    .reduce((sum, a) => sum + a.amountCents, 0);
  /* Display maths only - createBooking recomputes every number on the server,
     from the studio's own prices. */
  const liveServiceCents = selection
    ? flat
      ? svc.priceCents
      : svc.priceCents * selection.durationHours
    : 0;
  const liveTotalCents = liveServiceCents + (selection ? addOnCents : 0);
  const liveDepositCents = Math.round((liveTotalCents * svc.depositPct) / 100);
  const canSubmit = Boolean(selection) && formValid && !submitting;

  function toggleAddOn(id: Id<"feeTemplates">) {
    setChosenAddOns((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleContinue() {
    if (!selection || !formValid) return;
    setSubmitting(true);
    try {
      const result = await createBooking({
        serviceId: svc._id,
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        startTime: selection.startTime,
        durationHours: selection.durationHours,
        notes: form.notes.trim() || undefined,
        addOnFeeIds: chosenAddOns,
        ref: refFromLink,
        visitorKey: visitorKey() ?? undefined,
      });
      toast.success("Booking held - finish payment to confirm.");
      router.push(`/book/${slug}/checkout/${result.sessionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not hold that booking.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PublicTheme slug={slug} />
      <Link
        href={`/book/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        All services
      </Link>

      {svc.heroUrl && (
        <div className="relative overflow-hidden rounded-chrome border border-graphite/50 shadow-elev-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={svc.heroUrl}
            alt={svc.name}
            className="aspect-[21/9] w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
        </div>
      )}

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="overline">{svc.studioName}</p>
            <h1 className="chrome-display text-3xl leading-[0.95] tracking-[-0.01em] text-bone sm:text-4xl">
              {svc.name}
            </h1>
            {svc.blurb && <p className="max-w-xl text-sm text-steel">{svc.blurb}</p>}
          </div>
          <div className="text-right">
            <p className="font-meta text-2xl text-gold">
              {money(svc.priceCents)}
              <span className="text-sm text-steel">{flat ? "" : "/hr"}</span>
            </p>
            <p className="text-xs text-steel">
              {flat
                ? `${svc.blockHours}-hour session`
                : `${svc.minimumHours}-hour minimum`}
            </p>
          </div>
        </div>
        {svc.depositPolicy && <p className="text-xs text-steel/70">{svc.depositPolicy}</p>}
      </header>

      {svc.showGear && svc.equipment.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Music4 className="size-4 text-gold" />
            <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
              What you get
            </h2>
            <span className="text-xs text-steel/70">
              {svc.equipment.length} {svc.equipment.length === 1 ? "piece" : "pieces"}
            </span>
          </div>
          <GearGallery equipment={svc.equipment} />
        </section>
      )}

      {/* Details, then the time - the order the booking actually happens. */}
      <section className="space-y-3">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
          Your details
        </h2>
        <div className="space-y-5 rounded-lg border border-graphite/50 bg-coal p-5">
          <BookingForm values={form} onChange={setForm} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
          Pick your time
        </h2>
        <div className="rounded-lg border border-graphite/50 bg-coal p-5">
          <AvailabilityPicker
            roomId={svc.roomId}
            minimumHours={svc.minimumHours}
            hourlyRateCents={svc.hourlyRateCents}
            depositPct={svc.depositPct}
            closeHour={svc.closeHour}
            onChange={handleSelection}
          />
        </div>
      </section>

      {/* Add-ons for THIS service. A podcast booking offers podcast edits; a
          vocal session does not offer a film crew. */}
      {svc.addOns.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
            Add to your session
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {svc.addOns.map((a) => {
              const on = chosenAddOns.includes(a._id);
              return (
                <li key={a._id}>
                  <button
                    type="button"
                    onClick={() => toggleAddOn(a._id)}
                    aria-pressed={on}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                      on
                        ? "border-gold bg-gold/10"
                        : "border-graphite/50 bg-coal hover:border-graphite",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
                        on ? "border-gold bg-gold text-gold-ink" : "border-graphite/70",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-grotesk text-sm font-semibold text-bone">
                          {a.label}
                        </span>
                        <span className="font-meta text-sm text-gold">
                          {money(a.amountCents)}
                        </span>
                      </span>
                      {a.description && (
                        <span className="mt-1 block text-xs leading-relaxed text-steel">
                          {a.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-steel">
              {svc.name}
              {selection && !flat ? ` (${selection.durationHours}h)` : ""}
            </span>
            <span className="font-meta text-bone">
              {selection ? money(liveServiceCents) : "-"}
            </span>
          </div>
          {svc.addOns
            .filter((a) => chosenAddOns.includes(a._id))
            .map((a) => (
              <div key={a._id} className="flex items-center justify-between text-sm">
                <span className="text-steel">{a.label}</span>
                <span className="font-meta text-bone">{money(a.amountCents)}</span>
              </div>
            ))}
          <div className="flex items-center justify-between border-t border-graphite/40 pt-3">
            <span className="font-grotesk text-sm font-semibold text-bone">Total</span>
            <span className="font-meta text-lg text-bone">
              {selection ? money(liveTotalCents) : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-steel">Due now to hold it</span>
            <span className="font-meta text-gold">
              {selection ? money(liveDepositCents) : "-"}
            </span>
          </div>
          <Button
            className="w-full"
            disabled={!canSubmit}
            onClick={() => void handleContinue()}
          >
            {submitting ? "Holding…" : "Continue to payment"}
          </Button>
          {!selection && (
            <p className="text-center text-xs text-steel/70">
              Pick a date and time to see your total.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function ServiceSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
