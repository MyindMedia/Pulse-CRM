"use client";

import * as React from "react";
import { PublicTheme } from "@/components/shell/public-theme";
import { useTrackBookingStep, visitorKey } from "@/lib/use-booking-funnel";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import {
  AddOnsPicker,
  emptyAddOns,
  type AddOnSelection,
} from "@/components/book/add-ons-picker";
import { PromoCode, emptyPromo, type PromoState } from "@/components/book/promo-code";
import { SocialProof } from "@/components/book/social-proof";

/* useSearchParams() must sit under a Suspense boundary for static export. */
export default function RoomDetailPage() {
  return (
    <React.Suspense fallback={<RoomDetailSkeleton />}>
      <RoomDetailView />
    </React.Suspense>
  );
}

function RoomDetailView() {
  const { slug, roomId } = useParams<{ slug: string; roomId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Promo links (?code=XYZ) come from the studio's AI rate-cut emails.
  const codeFromLink = searchParams.get("code") ?? undefined;
  // Referral share links (?ref=<artistId>) attribute the booking to the client
  // who referred them; validated server-side in createBooking.
  const refFromLink = searchParams.get("ref") ?? undefined;
  const room = useQuery(api.booking.room, { roomId: roomId as Id<"rooms"> });
  useTrackBookingStep(slug, "room", { roomId: roomId as Id<"rooms"> });
  const createBooking = useMutation(api.booking.createBooking);

  const [selection, setSelection] = React.useState<SlotSelection | null>(null);
  const [form, setForm] = React.useState<BookingFormValues>(emptyBookingForm);
  const [addOns, setAddOns] = React.useState<AddOnSelection>(emptyAddOns);
  const [promo, setPromo] = React.useState<PromoState>(emptyPromo);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSelection = React.useCallback((s: SlotSelection | null) => {
    setSelection(s);
  }, []);

  /* Derived from form state alone, so it is computed before the loading and
     not-found guards below - the funnel hook needs it and hooks cannot sit
     under an early return. */
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim());
  const formValid = form.clientName.trim().length > 1 && emailValid;

  /* Reaching a valid selection IS the checkout step - the visitor is at the
     deposit. Fired from the effect rather than the click so an abandoned
     checkout still counts, which is the drop-off worth knowing about.

     This MUST stay above the early returns. It used to sit further down, past
     `if (room === undefined) return <Skeleton/>`, so the first render (room
     still loading) ran one funnel hook and the second ran two - React saw the
     hook count grow and threw #310. Every room booking link died on load.
     `enabled` is the correct way to make a hook conditional; position is not. */
  useTrackBookingStep(slug, "checkout", {
    roomId: roomId as Id<"rooms">,
    enabled: Boolean(room && selection && formValid),
  });

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

  // An invalid (or still-checking) code blocks submit: never book at full
  // price while a code sits in the box looking applied.
  const promoOk = promo.status === "none" || promo.status === "valid";
  const engineerOk = !addOns.needsEngineer || Boolean(addOns.engineerId);
  const canSubmit = Boolean(selection) && formValid && promoOk && engineerOk && !submitting;

  // Client-side display math only - createBooking recomputes the
  // authoritative amounts (and re-validates the code) on the server.
  const liveRoomCents = selection ? loadedRoom.hourlyRateCents * selection.durationHours : 0;
  const liveListCents = liveRoomCents + (selection ? addOns.addOnTotalCents : 0);
  const promoPct = promo.status === "valid" ? promo.pct : 0;
  const liveRateCents = promoPct
    ? Math.round((liveListCents * (100 - promoPct)) / 100)
    : liveListCents;
  const liveDiscountCents = liveListCents - liveRateCents;
  /* A paid-in-full room takes the whole amount up front; the "deposit" is the
     price. createBooking does the same sum server-side. */
  const fullOnly = loadedRoom.paymentMode === "full";
  const liveDepositCents = fullOnly
    ? liveRateCents
    : Math.round((liveRateCents * loadedRoom.depositPct) / 100);

  async function handleContinue() {
    if (!selection || !formValid || !promoOk) return;
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
        engineerId: addOns.engineerId,
        addOnEquipmentIds: addOns.gear.map((g) => g.id),
        gearRequestNote: addOns.gearRequestNote || undefined,
        discountCode: promo.status === "valid" ? promo.code : undefined,
        ref: refFromLink,
        // Closes the funnel this visitor started. Server-written from here on.
        visitorKey: visitorKey() ?? undefined,
      });
      toast.success("Booking held - finish payment to confirm.");
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
      <PublicTheme slug={slug} />
      <Link
        href={`/book/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        All rooms
      </Link>

      {/* Hero band - the actual room shot, if set */}
      {(room.heroUrl ?? room.heroImageUrl) && (
        <div className="relative overflow-hidden rounded-chrome border border-graphite/50 shadow-elev-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={(room.heroUrl ?? room.heroImageUrl)!}
            alt={`${room.name} interior`}
            className="aspect-[21/9] w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
        </div>
      )}

      {/* Room header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            {room.roomType && (
              <p className="overline">{room.roomType}</p>
            )}
            <h1 className="font-grotesk text-3xl font-semibold tracking-tight text-bone sm:text-4xl">
              {room.name}
            </h1>
          </div>
          <div className="rounded-lg border border-graphite/50 bg-coal-2 px-4 py-3 text-right">
            <p className="font-grotesk text-2xl font-semibold text-bone">
              {money(room.hourlyRateCents)}
              <span className="text-sm font-normal text-steel/70"> / hr</span>
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
            {room.paymentMode === "full"
              ? "Paid in full to book"
              : `${room.depositPct}% deposit holds your booking`}
          </Badge>
          {room.condition && (
            <Badge tone="neutral" className="capitalize">
              {room.condition.replace(/_/g, " ")} condition
            </Badge>
          )}
        </div>
      </header>

      {/* Gear list. Off is a real answer: a studio whose kit is half in storage
          would rather say nothing than publish a list it has to keep true. */}
      {room.showGear && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Music4 className="size-4 text-gold" />
            <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
              In this room
            </h2>
            <span className="text-xs text-steel/70">
              {room.equipment.length} {room.equipment.length === 1 ? "piece" : "pieces"}
            </span>
          </div>
          <GearGallery equipment={room.equipment} />
        </section>
      )}

      {/* Who they are, then when.

          These sat side by side, which asked a client on a laptop to fill a
          form and read a calendar at once, and on a phone put the form under
          the calendar - so the details arrived after the decision. Stacked,
          in the order the booking actually happens: name yourself, then pick
          the time you want. */}
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
            roomId={room._id}
            minimumHours={room.minimumHours}
            hourlyRateCents={room.hourlyRateCents}
            depositPct={room.depositPct}
            closeHour={room.closeHour}
            onChange={handleSelection}
          />
        </div>
      </section>

      {/* Add-ons: engineer + premium gear. Always visible - before a time is
          chosen the picker renders its own "pick a date and time" placeholder,
          so clients know the option exists instead of it appearing from
          nowhere after they select a slot. */}
      <section className="space-y-3">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">
          Engineer and add-ons
        </h2>
        <AddOnsPicker
          roomId={loadedRoom._id}
          selection={
            selection
              ? { startTime: selection.startTime, durationHours: selection.durationHours }
              : null
          }
          onChange={setAddOns}
        />
      </section>

      {/* Itemized total + continue */}
      <section className="space-y-3">
        <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-steel">
              Room {selection ? `(${selection.durationHours}h)` : ""}
            </span>
            <span className="font-meta text-bone">{selection ? money(liveRoomCents) : "-"}</span>
          </div>
          {addOns.engineerName && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-steel">Engineer</span>
              <span className="font-meta text-bone">{addOns.engineerName}</span>
            </div>
          )}
          {addOns.gear.map((g) => (
            <div key={g.id} className="flex items-center justify-between text-sm">
              <span className="text-steel">{g.name}</span>
              <span className="font-meta text-bone">{money(g.priceCents)}</span>
            </div>
          ))}

          {/* Promo code - prefilled from ?code= links, validated server-side */}
          <div className="border-t border-graphite/50 pt-3">
            <PromoCode
              roomId={loadedRoom._id}
              initialCode={codeFromLink}
              onChange={setPromo}
            />
          </div>
          {promo.status === "valid" && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-steel">Discount ({promo.pct}% off)</span>
              <span className="font-meta text-positive">
                {selection ? `-${money(liveDiscountCents)}` : "-"}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-graphite/50 pt-3 text-sm">
            <span className="font-grotesk font-semibold text-bone">Session total</span>
            <span className="font-meta font-semibold text-bone">
              {selection ? money(liveRateCents) : "-"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-steel">
              {fullOnly ? "Due now" : `Deposit to hold (${loadedRoom.depositPct}%)`}
            </span>
            <span className="font-meta text-gold-bright">
              {selection ? money(liveDepositCents) : "-"}
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
            <p className="text-center text-xs text-steel/70">
              Pick a date and time to continue.
            </p>
          )}
          {selection && !formValid && (
            <p className="text-center text-xs text-steel/70">
              Add your name and a valid email to continue.
            </p>
          )}
          {selection && formValid && !promoOk && (
            <p className="text-center text-xs text-steel/70">
              Fix or clear the discount code to continue.
            </p>
          )}
        </div>
      </section>

      {/* Social proof: real ratings + client words back the room's rate */}
      <SocialProof
        testimonials={room.testimonials}
        reviews={room.reviews}
        reviewStats={room.reviewStats}
      />
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
      {/* Gear placeholder: name rows, the shape the list actually loads into. */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
      {/* Details, then the picker - the order the page settles into. */}
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
