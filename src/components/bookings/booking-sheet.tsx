"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DoorOpen,
  Globe,
  Headphones,
  LogIn,
  Mail,
  MessageSquare,
  Music2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/feedback";
import { longDate, timeOfDay, duration, relativeTime } from "@/lib/format";
import { meta, SESSION_STATUS } from "@/lib/labels";
import type { BookingRow, NotificationRow, SessionStatus } from "./types";
import { isOnline } from "./types";
import { HoldCountdown } from "./hold-countdown";
import { PaymentPanel } from "./payment-panel";

function Row({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-steel/70">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-bone">{children}</div>
    </div>
  );
}

/** Learned no-show risk badge for one upcoming booking. Renders nothing for
 *  past, cancelled, or low-risk slots so it stays signal, never noise. */
function SessionRiskBadge({ sessionId }: { sessionId: BookingRow["_id"] }) {
  const risk = useQuery(api.predictions.sessionRisk, { sessionId });
  if (!risk || risk.band === "low") return null;
  const tone = risk.band === "high" ? "critical" : "gold";
  return (
    <Badge tone={tone}>
      <AlertTriangle className="size-2.5" />
      {risk.band === "high" ? "High no-show risk" : "Elevated no-show risk"} · suggest {risk.suggestedDepositPct}% deposit
    </Badge>
  );
}

/** The message log for one booking - read-only, simulated sends. */
function MessageLog({ sessionId }: { sessionId: BookingRow["_id"] }) {
  const messages = useQuery(api.notifications.forSession, { sessionId }) as
    | NotificationRow[]
    | undefined;

  return (
    <div className="space-y-1.5">
      <p className="overline">Message log</p>
      {messages === undefined ? (
        <div className="space-y-1.5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite/60 py-5 text-center text-xs text-steel/70">
          No confirmations or reminders sent for this booking yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {messages.map((msg) => (
            <li
              key={msg._id}
              className="rounded-md border border-graphite/50 bg-coal-2 p-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-bone">
                  {msg.channel === "email" ? (
                    <Mail className="size-3.5 text-steel/70" />
                  ) : (
                    <MessageSquare className="size-3.5 text-steel/70" />
                  )}
                  {msg.subject}
                </span>
                <span className="shrink-0 text-[0.625rem] text-steel/70">
                  {relativeTime(msg._creationTime)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-steel">
                {msg.body}
              </p>
              <p className="mt-1 font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
                {msg.channel} · {msg.recipient}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.625rem] text-steel/70">
        Confirmations and reminders are emailed to the client and logged here.
      </p>
    </div>
  );
}

/** Status transitions offered from the Bookings screen, mirroring the calendar
 *  SessionSheet workflow so both surfaces drive the same lifecycle. */
const NEXT_STATUSES: Record<SessionStatus, SessionStatus[]> = {
  tentative: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** "Check in" is the first-class verb for starting a session at the front desk. */
const STATUS_VERB: Record<SessionStatus, string> = {
  tentative: "Confirm",
  confirmed: "Confirm",
  in_progress: "Check in",
  completed: "Mark complete",
  cancelled: "Cancel",
  no_show: "Mark no-show",
};

/** Full booking detail drawer: schedule, payment, history and messages. */
export function BookingSheet({
  booking,
  onClose,
}: {
  booking: BookingRow | null;
  onClose: () => void;
}) {
  const open = booking !== null;
  // Member roster (with photos) so the engineer line can show their photo.
  const engineers = useQuery(api.members.engineers, booking ? {} : "skip");
  const engineerPhotoUrl =
    booking?.engineerId != null
      ? (engineers?.find((e) => e._id === booking.engineerId)?.photoUrl ?? null)
      : null;

  const setStatus = useMutation(api.sessions.setStatus);
  const [busy, setBusy] = useState(false);

  async function run(next: SessionStatus, ok: string) {
    if (!booking) return;
    setBusy(true);
    try {
      await setStatus({ id: booking._id, status: next });
      toast.success(ok);
    } catch {
      toast.error("Action failed - please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="md">
        {!booking ? null : (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta(SESSION_STATUS, booking.status).tone}>
                  {meta(SESSION_STATUS, booking.status).label}
                </Badge>
                {isOnline(booking) && (
                  <Badge tone="gold">
                    <Globe className="size-2.5" />
                    Online booking
                  </Badge>
                )}
                {booking.startTime > Date.now() && booking.status !== "cancelled" && (
                  <SessionRiskBadge sessionId={booking._id} />
                )}
              </div>
              <SheetTitle>{booking.title}</SheetTitle>
              <SheetDescription>
                {longDate(booking.startTime)} · {timeOfDay(booking.startTime)}–
                {timeOfDay(booking.endTime)} (
                {duration(booking.startTime, booking.endTime)})
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-5">
              <div className="divide-y divide-hairline">
                <Row label="Client">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={booking.artistName} size="xs" />
                    <span className="truncate">{booking.artistName}</span>
                  </span>
                </Row>
                <Row label="Song" icon={Music2}>
                  {booking.songTitle ?? (
                    <span className="text-steel/70">Not linked</span>
                  )}
                </Row>
                <Row label="Room" icon={DoorOpen}>
                  {booking.roomName ?? (
                    <span className="text-steel/70">Unassigned</span>
                  )}
                </Row>
                <Row label="Engineer" icon={Headphones}>
                  {booking.engineerName ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar
                        name={booking.engineerName}
                        src={engineerPhotoUrl}
                        size="xs"
                        className="rounded-full"
                      />
                      <span className="truncate">{booking.engineerName}</span>
                    </span>
                  ) : (
                    <span className="text-steel/70">Unassigned</span>
                  )}
                </Row>
                <Row label="Schedule" icon={Clock}>
                  {duration(booking.startTime, booking.endTime)} session
                </Row>
                {booking.status === "tentative" && booking.holdExpiresAt && (
                  <Row label="Hold">
                    <HoldCountdown expiresAt={booking.holdExpiresAt} />
                  </Row>
                )}
              </div>

              <PaymentPanel
                sessionId={booking._id}
                rateCents={booking.rateCents}
                depositCents={booking.depositCents}
                amountPaidCents={booking.amountPaidCents}
                cancelled={booking.status === "cancelled"}
              />

              <MessageLog sessionId={booking._id} />
            </SheetBody>

            {NEXT_STATUSES[booking.status].length > 0 && (
              <SheetFooter className="flex-wrap">
                {NEXT_STATUSES[booking.status].map((next) => (
                  <Button
                    key={next}
                    variant={
                      next === "cancelled" || next === "no_show"
                        ? "danger"
                        : next === "in_progress"
                          ? "primary"
                          : "secondary"
                    }
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(next, `Session ${meta(SESSION_STATUS, next).label.toLowerCase()}`)
                    }
                  >
                    {next === "in_progress" && <LogIn className="size-3.5" />}
                    {next === "completed" && <CheckCircle2 className="size-3.5" />}
                    {STATUS_VERB[next]}
                  </Button>
                ))}
                {busy && <Spinner />}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
