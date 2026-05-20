"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardCheck,
  Music2,
  Headphones,
  DoorOpen,
  Wallet,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/feedback";
import { money, longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS, titleCase } from "@/lib/labels";
import { PaymentPanel } from "@/components/bookings/payment-panel";
import { statusColor } from "./constants";

type SessionStatus =
  | "tentative"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

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
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ash-dim">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-bone">{children}</div>
    </div>
  );
}

/** Status changes available given the current status. */
const NEXT_STATUSES: Record<SessionStatus, SessionStatus[]> = {
  tentative: ["confirmed", "cancelled"],
  confirmed: ["in_progress", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: ["tentative"],
  no_show: ["tentative"],
};

const STATUS_VERB: Record<SessionStatus, string> = {
  tentative: "Set tentative",
  confirmed: "Confirm",
  in_progress: "Start session",
  completed: "Mark complete",
  cancelled: "Cancel",
  no_show: "Mark no-show",
};

/** Full session detail drawer with deposit, intake and status workflow. */
export function SessionSheet({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  const open = sessionId !== null;
  const detail = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<"sessions"> } : "skip",
  );

  const payDeposit = useMutation(api.sessions.payDeposit);
  const setStatus = useMutation(api.sessions.setStatus);
  const completeIntake = useMutation(api.sessions.completeIntake);

  const [busy, setBusy] = useState(false);
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setBusy(false);
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch {
      toast.error("Action failed — please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="md">
        {!detail ? (
          <>
            <SheetHeader>
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-4 w-36" />
            </SheetHeader>
            <SheetBody className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </SheetBody>
          </>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: statusColor(detail.status) }}
                />
                <Badge tone={meta(SESSION_STATUS, detail.status).tone}>
                  {meta(SESSION_STATUS, detail.status).label}
                </Badge>
                <Badge tone="neutral">{titleCase(detail.serviceType)}</Badge>
              </div>
              <SheetTitle>{detail.title}</SheetTitle>
              <SheetDescription>
                {longDate(detail.startTime)} · {timeOfDay(detail.startTime)}–
                {timeOfDay(detail.endTime)} ({duration(detail.startTime, detail.endTime)})
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-5">
              <div className="divide-y divide-hairline">
                <Row label="Artist">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={detail.artistName} size="xs" />
                    <span className="truncate">{detail.artistName}</span>
                  </span>
                </Row>
                <Row label="Song" icon={Music2}>
                  {detail.songTitle ?? <span className="text-ash-dim">Not linked</span>}
                </Row>
                <Row label="Engineer" icon={Headphones}>
                  {detail.engineerName ?? <span className="text-ash-dim">Unassigned</span>}
                </Row>
                <Row label="Room" icon={DoorOpen}>
                  {detail.roomName ?? <span className="text-ash-dim">Unassigned</span>}
                </Row>
                <Row label="Rate" icon={Wallet}>
                  <span className="font-mono font-semibold text-gold-bright">
                    {money(detail.rateCents)}
                  </span>
                </Row>
                <Row label="Deposit">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-ash">{money(detail.depositCents)}</span>
                    <Badge tone={detail.depositPaid ? "positive" : "caution"}>
                      {detail.depositPaid ? "Paid" : "Unpaid"}
                    </Badge>
                  </span>
                </Row>
                <Row label="Intake">
                  <Badge tone={detail.intakeCompleted ? "positive" : "caution"}>
                    {detail.intakeCompleted ? "Completed" : "Pending"}
                  </Badge>
                </Row>
              </div>

              {detail.notes && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-ash">Notes</p>
                  <p className="rounded-md border border-hairline bg-coal-2 p-3 text-sm leading-relaxed text-ash">
                    {detail.notes}
                  </p>
                </div>
              )}

              {/* Engineering log — the recall sheet */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-ash">Engineering log</p>
                {!detail.engineeringLog ? (
                  <p className="rounded-md border border-dashed border-hairline-2 py-6 text-center text-xs text-ash-dim">
                    No recall sheet logged for this session yet.
                  </p>
                ) : (
                  <div className="space-y-2 rounded-md border border-hairline bg-coal-2 p-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {(
                        [
                          ["Sample rate", detail.engineeringLog.sampleRate],
                          ["Bit depth", detail.engineeringLog.bitDepth],
                          ["Tuning", detail.engineeringLog.tuningRef],
                          ["Monitoring", detail.engineeringLog.monitoring],
                          ["Tempo map", detail.engineeringLog.tempoMap],
                        ] as const
                      )
                        .filter(([, val]) => Boolean(val))
                        .map(([label, val]) => (
                          <div key={label}>
                            <p className="font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">
                              {label}
                            </p>
                            <p className="text-sm text-bone">{val}</p>
                          </div>
                        ))}
                    </div>
                    {detail.engineeringLog.signalChains.length > 0 && (
                      <div className="space-y-1 border-t border-hairline pt-2">
                        <p className="font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">
                          Signal chains
                        </p>
                        {detail.engineeringLog.signalChains.map((chain, i) => (
                          <p key={i} className="text-xs text-ash">
                            <span className="text-bone">{chain.track}</span>
                            {chain.mic || chain.preamp || chain.outboard
                              ? ` — ${[chain.mic, chain.preamp, chain.outboard]
                                  .filter(Boolean)
                                  .join(" / ")}`
                              : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    {detail.engineeringLog.notes && (
                      <p className="border-t border-hairline pt-2 text-xs leading-relaxed text-ash">
                        {detail.engineeringLog.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Payment — booking ledger and staff record-a-payment */}
              <PaymentPanel
                sessionId={detail._id}
                rateCents={detail.rateCents}
                depositCents={detail.depositCents}
                amountPaidCents={detail.amountPaidCents}
                cancelled={detail.status === "cancelled"}
              />
            </SheetBody>

            <SheetFooter className="flex-wrap">
              {!detail.depositPaid && detail.status !== "cancelled" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => payDeposit({ id: detail._id }),
                      "Deposit recorded — session confirmed",
                    )
                  }
                >
                  <Wallet className="size-3.5" />
                  Take deposit
                </Button>
              )}

              {!detail.intakeCompleted && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => completeIntake({ id: detail._id }),
                      "Intake marked complete",
                    )
                  }
                >
                  <ClipboardCheck className="size-3.5" />
                  Complete intake
                </Button>
              )}

              {NEXT_STATUSES[detail.status as SessionStatus].map((next) => (
                <Button
                  key={next}
                  variant={next === "cancelled" || next === "no_show" ? "danger" : "secondary"}
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setStatus({ id: detail._id, status: next }),
                      `Session ${meta(SESSION_STATUS, next).label.toLowerCase()}`,
                    )
                  }
                >
                  {next === "completed" && <CheckCircle2 className="size-3.5" />}
                  {STATUS_VERB[next]}
                </Button>
              ))}

              {busy && <Spinner />}
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
