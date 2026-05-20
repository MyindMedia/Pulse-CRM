"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CheckCircle2,
  CircleSlash,
  Wallet,
  Receipt,
  Info,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money, timeOfDay, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { popIn, fadeUp } from "@/lib/motion";
import { BookingSummary } from "@/components/book/booking-summary";
import { PaymentForm } from "@/components/book/payment-form";

type PayChoice = "deposit" | "full";

export default function CheckoutPage() {
  const { slug, sessionId } = useParams<{ slug: string; sessionId: string }>();
  const booking = useQuery(api.booking.booking, {
    sessionId: sessionId as Id<"sessions">,
  });
  const recordPayment = useMutation(api.payments.record);

  const [choice, setChoice] = React.useState<PayChoice>("deposit");
  const [busy, setBusy] = React.useState(false);

  // Loading
  if (booking === undefined) {
    return <CheckoutSkeleton />;
  }

  // Not found
  if (booking === null) {
    return (
      <div className="mx-auto max-w-md py-10">
        <EmptyState
          icon={CircleSlash}
          title="Booking not found"
          description="We could not find this booking. The link may be wrong, or the hold was released."
          action={
            <Button asChild variant="outline">
              <Link href={`/book/${slug}`}>Back to studio</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const notPaid = booking.paidCents === 0;
  const released = booking.status === "cancelled";

  async function pay(kind: "deposit" | "balance" | "full", payerName: string) {
    setBusy(true);
    try {
      const result = await recordPayment({
        sessionId: sessionId as Id<"sessions">,
        kind,
        payerName,
      });
      toast.success(
        result.fullyPaid
          ? "Paid in full - your session is locked in."
          : `${money(result.paidTotal)} received - your booking is held.`,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Payment could not be processed.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link
        href={`/book/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        Studio
      </Link>

      {/* Confirmation banner once anything has been paid */}
      {!notPaid && !released && (
        <motion.div
          initial="hidden"
          animate="show"
          variants={popIn}
          className="flex flex-col items-center gap-3 rounded-lg border border-positive/30 bg-positive/10 px-6 py-8 text-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-positive/15 text-positive">
            <CheckCircle2 className="size-8" />
          </span>
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-bone">
              {booking.fullyPaid ? "You're booked" : "Your booking is held"}
            </h1>
            <p className="text-sm text-ash">
              {booking.fullyPaid
                ? "Paid in full. We've emailed your confirmation - see you in the studio."
                : "Your deposit cleared and the room is held. The balance is due up to 2 hours before your session."}
            </p>
          </div>
        </motion.div>
      )}

      {released && (
        <div className="rounded-lg border border-critical/30 bg-critical/10 px-5 py-4 text-sm text-critical">
          This booking was released and can no longer be paid. Start a new booking
          from the studio front.
        </div>
      )}

      {/* Unpaid hero */}
      {notPaid && !released && (
        <div className="space-y-1">
          <p className="overline">Checkout</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-bone">
            Hold your session
          </h1>
          <p className="text-sm text-ash">
            Pay a deposit to hold the room, or settle the full amount now.
          </p>
        </div>
      )}

      <BookingSummary booking={booking} />

      {/* Payment choice + form */}
      {notPaid && !released && (
        <motion.section
          initial="hidden"
          animate="show"
          variants={fadeUp}
          className="space-y-4 rounded-lg border border-hairline bg-coal p-5"
        >
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-gold" />
            <h2 className="font-display text-base font-semibold text-bone">
              Choose how to pay
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              active={choice === "deposit"}
              onClick={() => setChoice("deposit")}
              title="Pay deposit to hold"
              amountCents={booking.depositCents}
              note="Holds the room now."
            />
            <ChoiceCard
              active={choice === "full"}
              onClick={() => setChoice("full")}
              title="Pay in full"
              amountCents={booking.rateCents}
              note="Nothing left to pay."
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-hairline-2 bg-coal-2 px-3 py-2.5 text-xs text-ash">
            <Info className="size-3.5 shrink-0 text-gold-dim" />
            A deposit holds your booking; the balance is due up to 2 hours before
            your session, or the hold is released.
          </div>

          <div className="border-t border-hairline pt-4">
            <PaymentForm
              amountCents={
                choice === "deposit" ? booking.depositCents : booking.rateCents
              }
              actionLabel={choice === "deposit" ? "Pay deposit" : "Pay in full"}
              defaultName={booking.clientName}
              busy={busy}
              onSubmit={(payerName) =>
                pay(choice === "deposit" ? "deposit" : "full", payerName)
              }
            />
          </div>
        </motion.section>
      )}

      {/* Remaining balance after a deposit */}
      {!notPaid && !released && !booking.fullyPaid && (
        <motion.section
          initial="hidden"
          animate="show"
          variants={fadeUp}
          className="space-y-4 rounded-lg border border-hairline bg-coal p-5"
        >
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-gold" />
            <h2 className="font-display text-base font-semibold text-bone">
              Pay remaining balance
            </h2>
          </div>
          <p className="text-sm text-ash">
            {money(booking.balanceCents)} is still due on this session. You can
            settle it now or up to 2 hours before your start time.
          </p>
          <div className="border-t border-hairline pt-4">
            <PaymentForm
              amountCents={booking.balanceCents}
              actionLabel="Pay balance"
              defaultName={booking.clientName}
              busy={busy}
              onSubmit={(payerName) => pay("balance", payerName)}
            />
          </div>
        </motion.section>
      )}

      {/* Payment history */}
      {booking.payments.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="size-4 text-ash-dim" />
            <h2 className="font-display text-sm font-semibold text-bone">
              Payment history
            </h2>
          </div>
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-coal">
            {booking.payments.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-md bg-coal-2 text-positive">
                    <CheckCircle2 className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium capitalize text-bone">
                      {p.kind} payment
                    </p>
                    <p className="text-xs text-ash-dim">
                      {p.paidAt
                        ? `${shortDate(p.paidAt)} · ${timeOfDay(p.paidAt)}`
                        : "Pending"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={p.status === "paid" ? "positive" : "caution"}
                    className="capitalize"
                  >
                    {p.status}
                  </Badge>
                  <span className="font-mono text-sm text-bone">
                    {money(p.amountCents)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ChoiceCard({
  active,
  onClick,
  title,
  amountCents,
  note,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  amountCents: number;
  note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border p-4 text-left transition-colors",
        active
          ? "border-gold bg-gold/10"
          : "border-hairline-2 bg-coal-2 hover:border-gold-dim",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-sm font-medium",
            active ? "text-gold-bright" : "text-bone",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "grid size-4 place-items-center rounded-full border",
            active ? "border-gold bg-gold" : "border-hairline-2",
          )}
        >
          {active && <span className="size-1.5 rounded-full bg-gold-ink" />}
        </span>
      </div>
      <p className="mt-1 font-display text-xl font-semibold text-bone">
        {money(amountCents)}
      </p>
      <p className="text-xs text-ash-dim">{note}</p>
    </button>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Skeleton className="h-5 w-20" />
      <div className="flex flex-col items-center gap-3 py-6">
        <Loader2 className="size-6 animate-spin text-ash-dim" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
