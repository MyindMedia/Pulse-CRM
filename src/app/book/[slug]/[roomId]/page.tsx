"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ArrowLeft,
  Clock,
  ShieldCheck,
  Music4,
  ArrowRight,
  Loader2,
  DoorClosed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money } from "@/lib/format";
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

export default function RoomDetailPage() {
  const { slug, roomId } = useParams<{ slug: string; roomId: string }>();
  const router = useRouter();
  const room = useQuery(api.booking.room, { roomId: roomId as Id<"rooms"> });
  const createBooking = useMutation(api.booking.createBooking);

  const [selection, setSelection] = React.useState<SlotSelection | null>(null);
  const [form, setForm] = React.useState<BookingFormValues>(emptyBookingForm);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSelection = React.useCallback((s: SlotSelection | null) => {
    setSelection(s);
  }, []);

  // Loading
  if (room === undefined) {
    return <RoomDetailSkeleton />;
  }

  // Not found / retired
  if (room === null) {
    return (
      <div className="mx-auto max-w-md py-10">
        <EmptyState
          icon={DoorClosed}
          title="Room not available"
          description="This room is no longer open for booking, or the link is invalid."
          action={
            <Button asChild variant="outline">
              <Link href={`/book/${slug}`}>Back to studio</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // `room` is non-null past the guards above; bind a stable local for closures.
  const loadedRoom = room;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim());
  const formValid = form.clientName.trim().length > 1 && emailValid;
  const canSubmit = Boolean(selection) && formValid && !submitting;

  const liveRateCents = selection
    ? loadedRoom.hourlyRateCents * selection.durationHours
    : 0;
  const liveDepositCents = Math.round((liveRateCents * loadedRoom.depositPct) / 100);

  async function handleContinue() {
    if (!selection || !formValid) return;
    setSubmitting(true);
    try {
      const result = await createBooking({
        roomId: loadedRoom._id,
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        clientPhone: form.clientPhone.trim() || undefined,
        startTime: selection.startTime,
        durationHours: selection.durationHours,
        serviceType: form.serviceType,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Booking held — finish payment to confirm.");
      router.push(`/book/${slug}/checkout/${result.sessionId}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not hold that booking.";
      toast.error(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <Link
        href={`/book/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        All rooms
      </Link>

      {/* Room header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            {room.roomType && (
              <p className="overline">{room.roomType}</p>
            )}
            <h1 className="font-display text-3xl font-semibold tracking-tight text-bone sm:text-4xl">
              {room.name}
            </h1>
          </div>
          <div className="rounded-lg border border-hairline bg-coal-2 px-4 py-3 text-right">
            <p className="font-display text-2xl font-semibold text-bone">
              {money(room.hourlyRateCents)}
              <span className="text-sm font-normal text-ash-dim"> / hr</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            <Clock className="size-3" />
            {room.minimumHours}h minimum
          </Badge>
          <Badge tone="gold">
            <ShieldCheck className="size-3" />
            {room.depositPct}% deposit holds your booking
          </Badge>
          {room.condition && (
            <Badge tone="neutral" className="capitalize">
              {room.condition.replace(/_/g, " ")} condition
            </Badge>
          )}
        </div>
      </header>

      {/* Gear gallery */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Music4 className="size-4 text-gold" />
          <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
            In this room
          </h2>
          <span className="text-xs text-ash-dim">
            {room.equipment.length} {room.equipment.length === 1 ? "piece" : "pieces"}
          </span>
        </div>
        <GearGallery equipment={room.equipment} />
      </section>

      {/* Booking */}
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
            Pick your time
          </h2>
          <div className="rounded-lg border border-hairline bg-coal p-5">
            <AvailabilityPicker
              roomId={room._id}
              minimumHours={room.minimumHours}
              hourlyRateCents={room.hourlyRateCents}
              depositPct={room.depositPct}
              closeHour={room.closeHour}
              onChange={handleSelection}
            />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
            Your details
          </h2>
          <div className="space-y-5 rounded-lg border border-hairline bg-coal p-5">
            <BookingForm values={form} onChange={setForm} />

            <div className="space-y-3 border-t border-hairline pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ash">Session total</span>
                <span className="font-mono text-bone">
                  {selection ? money(liveRateCents) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ash">Deposit to hold</span>
                <span className="font-mono text-gold-bright">
                  {selection ? money(liveDepositCents) : "—"}
                </span>
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!canSubmit}
                onClick={handleContinue}
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Holding your slot…
                  </>
                ) : (
                  <>
                    Continue to payment
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>

              {!selection && (
                <p className="text-center text-xs text-ash-dim">
                  Pick a date and time to continue.
                </p>
              )}
              {selection && !formValid && (
                <p className="text-center text-xs text-ash-dim">
                  Add your name and a valid email to continue.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function RoomDetailSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  );
}
