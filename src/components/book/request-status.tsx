"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CheckCircle, Clock, XCircle, ArrowLeft } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { popIn } from "@/lib/motion";
import { shortDate, timeOfDay } from "@/lib/format";

/* Booking request state on the public confirmation page.

   `RequestStatusPage` replaces the whole checkout for a request made on a
   link without prices (the server sent no amounts and no payment is taken).
   `RequestPendingBanner` sits above the priced checkout when the studio
   approves every booking: the booker pays as usual, the studio still decides. */

type RequestState = "pending" | "approved" | "declined" | null;

export type RequestBooking = {
  requestStatus: RequestState;
  status: string;
  roomName: string;
  engineerName: string | null;
  startTime: number;
  endTime: number;
  addOns: { name: string }[];
  serviceAddOns: { label: string }[];
  gearRequestNote?: string;
};

function copyFor(b: RequestBooking) {
  if (b.requestStatus === "declined" || b.status === "cancelled") {
    return {
      Icon: XCircle,
      tone: "border-critical/30 bg-critical/10 text-critical",
      title: "The studio couldn't take this request",
      body: "We sent you an email and a text. Send a new request anytime and we'll find another time.",
    };
  }
  if (b.requestStatus === "approved" || b.status === "confirmed") {
    return {
      Icon: CheckCircle,
      tone: "border-positive/30 bg-positive/10 text-positive",
      title: "You're confirmed",
      body: "The studio approved your request. Your confirmation with the address is in your email and texts.",
    };
  }
  return {
    Icon: Clock,
    tone: "border-gold/30 bg-gold/10 text-gold",
    title: "Request sent",
    body: "Your request is holding the time while the studio reviews it. We'll email and text you as soon as it's confirmed.",
  };
}

export function RequestStatusPage({ slug, booking }: { slug: string; booking: RequestBooking }) {
  const c = copyFor(booking);
  const rows: [string, string][] = [
    ["Date", shortDate(booking.startTime)],
    ["Time", `${timeOfDay(booking.startTime)} to ${timeOfDay(booking.endTime)}`],
    ["Room", booking.roomName],
    ...(booking.engineerName ? ([["Engineer", booking.engineerName]] as [string, string][]) : []),
    ...booking.addOns.map((a) => ["Gear", a.name] as [string, string]),
    ...booking.serviceAddOns.map((a) => ["Add-on", a.label] as [string, string]),
    ...(booking.gearRequestNote ? ([["Gear request", booking.gearRequestNote]] as [string, string][]) : []),
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link
        href={`/book/${slug}`}
        className="inline-flex items-center gap-1.5 text-sm text-steel hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        Studio
      </Link>
      <motion.div
        initial="hidden"
        animate="show"
        variants={popIn}
        className={`flex flex-col items-center gap-3 rounded-lg border px-6 py-8 text-center ${c.tone}`}
      >
        <c.Icon className="size-10" />
        <div className="space-y-1">
          <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-bone">{c.title}</h1>
          <p className="text-sm text-steel">{c.body}</p>
        </div>
      </motion.div>
      <dl className="divide-y divide-hairline overflow-hidden rounded-lg border border-graphite/50 bg-coal">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
            <dt className="text-steel">{k}</dt>
            <dd className="min-w-0 truncate text-right text-bone">{v}</dd>
          </div>
        ))}
      </dl>
      {(booking.requestStatus === "declined" || booking.status === "cancelled") && (
        <Button asChild variant="outline" className="w-full">
          <Link href={`/book/${slug}`}>Send a new request</Link>
        </Button>
      )}
    </div>
  );
}

export function RequestPendingBanner({ requestStatus }: { requestStatus: RequestState }) {
  if (requestStatus !== "pending") return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-gold/30 bg-gold/10 px-4 py-3.5 text-sm text-bone">
      <Clock className="mt-0.5 size-4 shrink-0 text-gold" />
      <p>
        <span className="font-medium">Waiting on the studio.</span>{" "}
        <span className="text-steel">
          The studio reviews every booking and we&apos;ll email and text you once it&apos;s confirmed.
          Paying the deposit keeps your request moving.
        </span>
      </p>
    </div>
  );
}
