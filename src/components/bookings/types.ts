/* ============================================================
   Bookings module - shared types and money math for the staff
   command center over online bookings, holds and deposits.
   ============================================================ */

import type { Id } from "@convex/_generated/dataModel";

export type SessionStatus =
  | "tentative"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

/** A hydrated session row as returned by `api.sessions.list`. */
export type BookingRow = {
  _id: Id<"sessions">;
  title: string;
  artistId: Id<"artists">;
  artistName: string;
  songTitle?: string | null;
  roomId?: Id<"rooms">;
  roomName?: string | null;
  engineerId?: Id<"members">;
  engineerName?: string | null;
  startTime: number;
  endTime: number;
  status: SessionStatus;
  rateCents: number;
  depositCents: number;
  depositPaid: boolean;
  amountPaidCents?: number;
  source?: "public_booking" | "internal";
  holdExpiresAt?: number;
  balanceRemindedAt?: number;
  // Comped (no-charge) bookings: billed nothing, but carry the forgone value.
  comped?: boolean;
  compReason?: string;
  compedValueCents?: number;
};

/** A recorded payment as returned by `api.payments.forSession` / `recent`. */
export type PaymentRow = {
  _id: Id<"payments">;
  sessionId: Id<"sessions">;
  kind: "deposit" | "balance" | "full";
  amountCents: number;
  provider: string;
  status: string;
  paidAt?: number;
  payerName?: string;
  reference?: string;
  _creationTime: number;
};

/** A logged notification as returned by `api.notifications.recent` / `forSession`. */
export type NotificationRow = {
  _id: Id<"notifications">;
  channel: "email" | "sms";
  recipient: string;
  subject: string;
  body: string;
  kind: string;
  status: string;
  _creationTime: number;
};

/** Settled money math for one booking. Treats undefined paid as 0. */
export type BookingMoney = {
  paid: number;
  total: number;
  deposit: number;
  balance: number;
  fullyPaid: boolean;
  /** 0..1 - paid over total. */
  ratio: number;
};

export function bookingMoney(b: {
  rateCents: number;
  depositCents: number;
  amountPaidCents?: number;
}): BookingMoney {
  const paid = b.amountPaidCents ?? 0;
  const total = b.rateCents;
  return {
    paid,
    total,
    deposit: b.depositCents,
    balance: Math.max(0, total - paid),
    fullyPaid: paid >= total,
    ratio: total > 0 ? Math.min(1, paid / total) : 0,
  };
}

/** Which lane a booking belongs in on the pipeline. */
export type Lane = "holds" | "balanceDue" | "paidInFull" | "released";

export function laneFor(b: BookingRow): Lane {
  if (b.status === "cancelled" || b.status === "no_show") return "released";
  if (b.status === "tentative") return "holds";
  const { fullyPaid } = bookingMoney(b);
  if (fullyPaid) return "paidInFull";
  return "balanceDue";
}

/** Is this an online (public-booking-flow) session? */
export function isOnline(b: BookingRow): boolean {
  return b.source === "public_booking";
}
