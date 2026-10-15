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
  Music2,
} from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  MessageLog,
  SessionFilesPanel,
  SessionHistoryPanel,
  SessionInvoicesPanel,
  SessionNotesPanel,
  SpecialRequestsPanel,
} from "@/components/calendar/session-extras";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS } from "@/lib/labels";
import type { BookingRow, SessionStatus } from "./types";
import { isOnline } from "./types";
import { HoldCountdown } from "./hold-countdown";
import { RequestBadge, RequestDecision } from "./request-decision";
import { PaymentPanel } from "./payment-panel";
import { PendingChangeBanner } from "./pending-change-banner";
import { ChangedInGoogleBadge } from "@/components/calendar/changed-in-google-badge";
import { proposalNotice } from "@/lib/change-proposal";
import { EntityLink } from "@/components/shell/entity-link";

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

/** Full booking detail in a centered modal: schedule, client, payment,
 *  special requests, staff notes, files and songs, invoices, history and
 *  messages. */
export function BookingSheet({
  booking,
  onClose,
}: {
  booking: BookingRow | null;
  onClose: () => void;
}) {
  const open = booking !== null;
  // The full booking (special requests, add-ons) for the requests panel.
  const full = useQuery(api.sessions.get, booking ? { id: booking._id } : "skip");
  // Member roster (with photos) so the engineer line can show their photo.
  const engineers = useQuery(api.members.engineers, booking ? {} : "skip");
  const engineerPhotoUrl =
    booking?.engineerId != null
      ? (engineers?.find((e) => e._id === booking.engineerId)?.photoUrl ?? null)
      : null;

  const setStatus = useMutation(api.sessions.setStatus);
  const [busy, setBusy] = useState(false);
  // Status changes that deserve a beat of confirmation - one stray tap
  // should never cancel a session or mark a client a no-show.
  const [confirmNext, setConfirmNext] = useState<SessionStatus | null>(null);
  const CONFIRM_COPY: Partial<Record<SessionStatus, { title: string; body: string; cta: string }>> = {
    cancelled: {
      title: "Cancel this session?",
      body: "The slot opens back up and the client is notified where applicable. This can be rebooked but not undone.",
      cta: "Cancel session",
    },
    no_show: {
      title: "Mark as no-show?",
      body: "Records the client as absent - deposit handling follows your no-show policy. Make sure they really did not arrive.",
      cta: "Mark no-show",
    },
    in_progress: {
      title: "Check the client in?",
      body: "Starts the session clock, flips the room to in-use and notifies the team the session is live.",
      cta: "Check in",
    },
  };

  async function run(next: SessionStatus, ok: string) {
    if (!booking) return;
    setBusy(true);
    try {
      const res = await setStatus({ id: booking._id, status: next });
      if (!proposalNotice(res)) toast.success(ok);
    } catch {
      toast.error("Action failed - please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="xl">
        {!booking ? null : (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta(SESSION_STATUS, booking.status).tone}>
                  {meta(SESSION_STATUS, booking.status).label}
                </Badge>
                <RequestBadge requestStatus={booking.requestStatus} />
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
                {longDate(booking.startTime)} · {timeOfDay(booking.startTime)} - {timeOfDay(booking.endTime)} (
                {duration(booking.startTime, booking.endTime)})
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-5">
              <RequestDecision
                sessionId={booking._id}
                requestStatus={booking.requestStatus}
                amountPaidCents={booking.amountPaidCents}
                onDecided={onClose}
              />
              <PendingChangeBanner sessionId={booking._id} />
              <ChangedInGoogleBadge sessionId={booking._id} changedAt={("googleChangedAt" in booking ? booking.googleChangedAt : undefined) as number | undefined} />
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="min-w-0 space-y-5">
                  <div className="divide-y divide-hairline">
                    <Row label="Client">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={booking.artistName} size="xs" />
                        <EntityLink type="artist" id={booking.artistId} className="truncate hover:underline">
                          {booking.artistName}
                        </EntityLink>
                      </span>
                    </Row>
                    <Row label="Song" icon={Music2}>
                      {booking.songTitle ? (
                        <EntityLink type="song" id={booking.songId} className="hover:underline">
                          {booking.songTitle}
                        </EntityLink>
                      ) : (
                        <span className="text-steel/70">Not linked</span>
                      )}
                    </Row>
                    <Row label="Room" icon={DoorOpen}>
                      {booking.roomName ? (
                        <EntityLink type="room" id={booking.roomId} className="hover:underline">
                          {booking.roomName}
                        </EntityLink>
                      ) : (
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

                  {full && <SpecialRequestsPanel session={full} />}

                  <SessionNotesPanel sessionId={booking._id} />

                  <SessionFilesPanel sessionId={booking._id} artistId={booking.artistId} />

                </div>
                <div className="min-w-0 space-y-5">
                  <PaymentPanel
                    sessionId={booking._id}
                    rateCents={booking.rateCents}
                    depositCents={booking.depositCents}
                    amountPaidCents={booking.amountPaidCents}
                    cancelled={booking.status === "cancelled"}
                  />

                  <SessionInvoicesPanel sessionId={booking._id} />

                  <SessionHistoryPanel sessionId={booking._id} />

                  <MessageLog sessionId={booking._id} />

                </div>
              </div>
            </SheetBody>

            {NEXT_STATUSES[booking.status].length > 0 && (
              <SheetFooter className="flex-wrap gap-2 pt-3">
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
                    className="min-w-[7.5rem] flex-1"
                    disabled={busy}
                    onClick={() =>
                      CONFIRM_COPY[next]
                        ? setConfirmNext(next)
                        : run(next, `Session ${meta(SESSION_STATUS, next).label.toLowerCase()}`)
                    }
                  >
                    {next === "in_progress" && <LogIn className="size-4" />}
                    {next === "completed" && <CheckCircle2 className="size-4" />}
                    {STATUS_VERB[next]}
                  </Button>
                ))}
                {busy && <Spinner />}
              </SheetFooter>
            )}

            {/* Confirmation for cancel / no-show / check-in */}
            <Dialog open={confirmNext !== null} onOpenChange={(o) => !o && setConfirmNext(null)}>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>{confirmNext ? CONFIRM_COPY[confirmNext]?.title : ""}</DialogTitle>
                </DialogHeader>
                <DialogBody>
                  <p className="text-sm text-steel">
                    {confirmNext ? CONFIRM_COPY[confirmNext]?.body : ""}
                  </p>
                </DialogBody>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button" variant="ghost">
                      Keep as is
                    </Button>
                  </DialogClose>
                  <Button
                    variant={confirmNext === "in_progress" ? "primary" : "danger"}
                    disabled={busy}
                    onClick={() => {
                      if (!confirmNext) return;
                      const next = confirmNext;
                      setConfirmNext(null);
                      void run(next, `Session ${meta(SESSION_STATUS, next).label.toLowerCase()}`);
                    }}
                  >
                    {confirmNext ? CONFIRM_COPY[confirmNext]?.cta : ""}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
