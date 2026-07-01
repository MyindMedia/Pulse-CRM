"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2,
  ClipboardCheck,
  Music2,
  Headphones,
  DoorOpen,
  Wallet,
  Copy,
  Check,
  MessageSquare,
  Link2,
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
import { ChecklistsPanel } from "./checklists-panel";
import { SessionAiPanel } from "@/components/ai/session-ai-panel";
import { CompDialog } from "./comp-dialog";
import { Gift } from "lucide-react";

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
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-steel/70">
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
  // Member roster (with photos) so the engineer line can show their photo.
  const engineers = useQuery(api.members.engineers, sessionId ? {} : "skip");
  const engineerPhotoUrl =
    detail?.engineerId != null
      ? (engineers?.find((e) => e._id === detail.engineerId)?.photoUrl ?? null)
      : null;

  const payDeposit = useMutation(api.sessions.payDeposit);
  const setStatus = useMutation(api.sessions.setStatus);
  const completeIntake = useMutation(api.sessions.completeIntake);
  const [compOpen, setCompOpen] = useState(false);

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
      toast.error("Action failed - please retry");
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
                  {detail.songTitle ?? <span className="text-steel/70">Not linked</span>}
                </Row>
                <Row label="Engineer" icon={Headphones}>
                  {detail.engineerName ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar
                        name={detail.engineerName}
                        src={engineerPhotoUrl}
                        size="xs"
                        className="rounded-full"
                      />
                      <span className="truncate">{detail.engineerName}</span>
                    </span>
                  ) : (
                    <span className="text-steel/70">Unassigned</span>
                  )}
                </Row>
                <Row label="Room" icon={DoorOpen}>
                  {detail.roomName ?? <span className="text-steel/70">Unassigned</span>}
                </Row>
                <Row label="Rate" icon={Wallet}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-meta font-semibold text-gold-bright">
                      {money(detail.rateCents)}
                    </span>
                    {detail.compType && (
                      <Badge tone="caution" className="capitalize">
                        {detail.compType} ·{" "}
                        {money(Math.max(0, (detail.listValueCents ?? detail.rateCents) - detail.rateCents))} foregone
                      </Badge>
                    )}
                    {detail.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => setCompOpen(true)}
                        className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-steel transition-colors hover:text-gold"
                      >
                        <Gift className="size-3" />
                        {detail.compType ? "Edit comp" : "Comp / discount"}
                      </button>
                    )}
                  </span>
                </Row>
                <Row label="Deposit">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-meta text-steel">{money(detail.depositCents)}</span>
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
                  <p className="text-xs font-medium text-steel">Notes</p>
                  <p className="rounded-md border border-graphite/50 bg-coal-2 p-3 text-sm leading-relaxed text-steel">
                    {detail.notes}
                  </p>
                </div>
              )}

              {/* Pre + post session checklists for staff / interns */}
              <ChecklistsPanel sessionId={detail._id} />

              {/* AI artifacts: recap email, prep packet, reminders */}
              <SessionAiPanel sessionId={detail._id} />

              {/* Engineering log - the recall sheet */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-steel">Engineering log</p>
                {!detail.engineeringLog ? (
                  <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
                    No recall sheet logged for this session yet.
                  </p>
                ) : (
                  <div className="space-y-2 rounded-md border border-graphite/50 bg-coal-2 p-3">
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
                            <p className="font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
                              {label}
                            </p>
                            <p className="text-sm text-bone">{val}</p>
                          </div>
                        ))}
                    </div>
                    {detail.engineeringLog.signalChains.length > 0 && (
                      <div className="space-y-1 border-t border-graphite/50 pt-2">
                        <p className="font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
                          Signal chains
                        </p>
                        {detail.engineeringLog.signalChains.map((chain, i) => (
                          <p key={i} className="text-xs text-steel">
                            <span className="text-bone">{chain.track}</span>
                            {chain.mic || chain.preamp || chain.outboard
                              ? ` - ${[chain.mic, chain.preamp, chain.outboard]
                                  .filter(Boolean)
                                  .join(" / ")}`
                              : ""}
                          </p>
                        ))}
                      </div>
                    )}
                    {detail.engineeringLog.notes && (
                      <p className="border-t border-graphite/50 pt-2 text-xs leading-relaxed text-steel">
                        {detail.engineeringLog.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Payment - booking ledger and staff record-a-payment */}
              <PaymentPanel
                sessionId={detail._id}
                rateCents={detail.rateCents}
                depositCents={detail.depositCents}
                amountPaidCents={detail.amountPaidCents}
                cancelled={detail.status === "cancelled"}
              />

              {/* Collect balance on the spot - pay link + QR / copy / text */}
              <CollectBalancePanel
                sessionId={detail._id}
                balanceCents={Math.max(
                  0,
                  detail.rateCents - (detail.amountPaidCents ?? 0),
                )}
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
                      "Deposit recorded - session confirmed",
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
            <CompDialog session={detail} open={compOpen} onOpenChange={setCompOpen} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * On-the-spot balance collection. Shows the outstanding balance, the public pay
 * link (with a scannable QR when available), a big Copy button, and a one-tap
 * "Text the link" that reuses the studio's SMS seam. Mobile-friendly so staff
 * can settle up at the desk.
 */
function CollectBalancePanel({
  sessionId,
  balanceCents,
}: {
  sessionId: Id<"sessions">;
  balanceCents: number;
}) {
  const link = useQuery(api.sessions.payLink, { id: sessionId });
  const sendSms = useMutation(api.sessions.sendPayLinkSms);
  const [copied, setCopied] = useState(false);
  const [texting, setTexting] = useState(false);

  if (balanceCents <= 0) return null;

  const url = link?.url ?? null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Pay link copied");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy - long-press the link to copy it");
    }
  }

  async function text() {
    setTexting(true);
    try {
      await sendSms({ id: sessionId });
      toast.success("Pay link texted to the client");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the text");
    } finally {
      setTexting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-gold/25 bg-gold/[0.04] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-steel">
          <Wallet className="size-3.5 text-gold" />
          Collect balance
        </p>
        <span className="font-meta text-sm font-semibold text-gold-bright">
          {money(balanceCents)}
        </span>
      </div>

      {!url ? (
        <p className="text-xs text-steel/70">
          Connect a booking slug in Settings to generate a pay link.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="shrink-0 self-center rounded-md border border-graphite/50 bg-white p-1.5">
            <QRCodeSVG value={url} size={104} marginSize={0} aria-label="Scan to pay" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-1.5 truncate rounded border border-graphite/50 bg-coal-2 px-2 py-1.5 font-meta text-[0.6875rem] text-steel">
              <Link2 className="size-3 shrink-0 text-steel/70" />
              <span className="truncate">{url}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={copy} className="flex-1">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={text}
                disabled={texting || !link?.hasPhone}
                title={link?.hasPhone ? undefined : "No phone number on file"}
              >
                <MessageSquare className="size-3.5" />
                {texting ? "Texting…" : "Text the link"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
