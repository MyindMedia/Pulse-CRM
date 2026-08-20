"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { useCapabilities } from "@/lib/use-capabilities";
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
  Timer,
  Clock,
  PackagePlus,
  PackageCheck,
  NotebookPen,
  CalendarPlus,
  Plus,
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
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { money, longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS, titleCase } from "@/lib/labels";
import { PaymentPanel } from "@/components/bookings/payment-panel";
import { statusColor } from "./constants";
import { ChecklistsPanel } from "./checklists-panel";
import { SessionAiPanel } from "@/components/ai/session-ai-panel";
import { CompDialog } from "./comp-dialog";
import { BookSessionDialog, type SessionPrefill } from "./book-session-dialog";
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
  const { can } = useCapabilities();
  const overrideConfirm = useMutation(api.sessions.overrideEngineerConfirmation);
  const engineerPhotoUrl =
    detail?.engineerId != null
      ? (engineers?.find((e) => e._id === detail.engineerId)?.photoUrl ?? null)
      : null;

  const payDeposit = useMutation(api.sessions.payDeposit);
  const setStatus = useMutation(api.sessions.setStatus);
  const completeIntake = useMutation(api.sessions.completeIntake);
  const [compOpen, setCompOpen] = useState(false);
  const [rebookOpen, setRebookOpen] = useState(false);

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
                {longDate(detail.startTime)} · {timeOfDay(detail.startTime)} - {timeOfDay(detail.endTime)} ({duration(detail.startTime, detail.endTime)})
              </SheetDescription>
              {detail.status === "in_progress" && <LiveTimer startTime={detail.startTime} />}
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
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Avatar
                        name={detail.engineerName}
                        src={engineerPhotoUrl}
                        size="xs"
                        className="rounded-full"
                      />
                      <span className="truncate">{detail.engineerName}</span>
                      {detail.engineerRequestStatus === "pending" && (
                        <>
                          <Badge tone="caution">awaiting confirmation</Badge>
                          {can("schedule.manage") && (
                            <button
                              type="button"
                              className="text-xs font-medium text-gold hover:underline"
                              onClick={() =>
                                void overrideConfirm({ sessionId: detail._id })
                                  .then(() => toast.success("Booking finalized by override."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not override."))
                              }
                            >
                              Confirm on their behalf
                            </button>
                          )}
                        </>
                      )}
                      {detail.engineerRequestStatus === "confirmed" && (
                        <Badge tone="positive">confirmed</Badge>
                      )}
                      {detail.engineerRequestStatus === "overridden" && (
                        <Badge tone="gold">finalized by manager</Badge>
                      )}
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

              {/* Mid-session floor actions: extend the window + add gear */}
              {detail.status !== "cancelled" &&
                detail.status !== "no_show" &&
                detail.status !== "completed" && (
                  <FloorActionsPanel sessionId={detail._id} busy={busy} setBusy={setBusy} />
                )}

              {/* Pre + post session checklists for staff / interns */}
              <ChecklistsPanel sessionId={detail._id} />

              {/* AI artifacts: recap email, prep packet, reminders */}
              <SessionAiPanel sessionId={detail._id} />

              {/* Engineering log - the recall sheet, now editable */}
              <RecallPanel sessionId={detail._id} log={detail.engineeringLog ?? null} />

              {/* Payment - booking ledger and staff record-a-payment */}
              <PaymentPanel
                sessionId={detail._id}
                rateCents={detail.rateCents}
                depositCents={detail.depositCents}
                amountPaidCents={detail.amountPaidCents}
                cancelled={detail.status === "cancelled"}
              />

              {/* Apply prepaid package hours - draw down a client's active credit */}
              {detail.status !== "cancelled" && (
                <ApplyPackagePanel
                  sessionId={detail._id}
                  artistId={detail.artistId}
                  rateCents={detail.rateCents}
                />
              )}

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

              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setRebookOpen(true)}
              >
                <CalendarPlus className="size-3.5" />
                Book again
              </Button>

              {busy && <Spinner />}
            </SheetFooter>
            <CompDialog session={detail} open={compOpen} onOpenChange={setCompOpen} />
            <BookSessionDialog
              open={rebookOpen}
              onOpenChange={setRebookOpen}
              prefillFrom={
                {
                  artistId: detail.artistId,
                  artistName: detail.artistName,
                  serviceType: detail.serviceType,
                  roomId: detail.roomId ?? undefined,
                  engineerId: detail.engineerId ?? undefined,
                  songId: detail.songId ?? undefined,
                  rateCents: detail.rateCents,
                  title: detail.title,
                } satisfies SessionPrefill
              }
            />
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

/**
 * Apply prepaid package hours to this session. Shows the client's active credits
 * (hours remaining + per-hour value); the operator picks a credit and applies N
 * hours, which reduces the session's charged rate and draws the balance down.
 * Studio-initiated - the public booking flow is untouched.
 */
function ApplyPackagePanel({
  sessionId,
  artistId,
  rateCents,
}: {
  sessionId: Id<"sessions">;
  artistId: Id<"artists">;
  rateCents: number;
}) {
  const credits = useQuery(api.packages.creditsForArtist, { artistId });
  const redeem = useMutation(api.packages.redeem);
  const [creditId, setCreditId] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);

  // Nothing to show until the client has an active credit with hours left.
  if (!credits || credits.length === 0) return null;

  const selected = credits.find((c) => c._id === creditId) ?? null;

  async function apply() {
    if (!selected) {
      toast.error("Pick a package first.");
      return;
    }
    const n = parseFloat(hours);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter how many hours to apply.");
      return;
    }
    setBusy(true);
    try {
      const res = await redeem({
        sessionId,
        creditId: selected._id,
        hours: n,
      });
      toast.success(
        `Applied ${res.hoursApplied}h - ${money(res.valueCents)} covered, rate now ${money(res.rateCents)}`,
      );
      setHours("");
      setCreditId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply the package");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-gold/25 bg-gold/[0.04] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-steel">
          <PackageCheck className="size-3.5 text-gold" />
          Apply package hours
        </p>
        <span className="font-meta text-xs text-steel">Rate {money(rateCents)}</span>
      </div>

      <Select value={creditId} onValueChange={setCreditId}>
        <SelectTrigger>
          <SelectValue placeholder="Choose a prepaid block" />
        </SelectTrigger>
        <SelectContent>
          {credits.map((c) => (
            <SelectItem key={c._id} value={c._id}>
              {c.name} · {c.hoursRemaining}h left · {money(c.perHourCents)}/hr
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Hours to apply" className="flex-1">
          <Input
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={selected ? String(selected.hoursRemaining) : "0"}
          />
        </Field>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !selected}
          onClick={() => void apply()}
        >
          <PackageCheck className="size-3.5" />
          Apply
        </Button>
      </div>
    </div>
  );
}

/**
 * Live elapsed-time readout for a session that's in progress. Ticks client-side
 * every second, counting up from the scheduled start.
 */
function LiveTimer({ startTime }: { startTime: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const totalSec = Math.max(0, Math.floor((now - startTime) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 font-meta text-xs font-semibold text-gold-bright">
      <Timer className="size-3.5 animate-pulse" />
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`} elapsed
    </span>
  );
}

/**
 * Mid-session / turnover floor actions: quick-extend the window (+30 / +60,
 * overtime becomes billable through the recomputed rate) and add premium gear
 * to a live session (conflict-checked, price folded into the rate).
 */
function FloorActionsPanel({
  sessionId,
  busy,
  setBusy,
}: {
  sessionId: Id<"sessions">;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const extend = useMutation(api.sessions.extend);
  const addGear = useMutation(api.sessions.addGear);
  const gear = useQuery(api.sessions.gearOptions, { id: sessionId });
  const [gearId, setGearId] = useState("");

  async function runExtend(mins: number) {
    setBusy(true);
    try {
      const res = await extend({ id: sessionId, addMinutes: mins });
      toast.success(`Extended ${mins} min - rate now ${money(res.rateCents)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not extend the session");
    } finally {
      setBusy(false);
    }
  }

  async function runAddGear() {
    if (!gearId) return;
    setBusy(true);
    try {
      const res = await addGear({ id: sessionId, equipmentId: gearId as Id<"equipment"> });
      toast.success(`Gear added - rate now ${money(res.rateCents)}`);
      setGearId("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the gear");
    } finally {
      setBusy(false);
    }
  }

  const options = (gear ?? []).filter((g) => g.available);

  return (
    <div className="space-y-3 rounded-md border border-graphite/50 bg-coal-2 p-3">
      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-steel">
        <Clock className="size-3.5 text-gold" />
        Floor actions
      </p>

      <div className="space-y-1.5">
        <p className="font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
          Extend session
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => runExtend(30)}>
            <Plus className="size-3.5" />
            30 min
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => runExtend(60)}>
            <Plus className="size-3.5" />
            60 min
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
          Add gear
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={gearId} onValueChange={setGearId}>
            <SelectTrigger className="flex-1">
              <SelectValue
                placeholder={
                  options.length ? "Select premium gear" : "No rentable gear free for this window"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} · {money(g.priceCents)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !gearId}
            onClick={runAddGear}
          >
            <PackagePlus className="size-3.5" />
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

type RecallLog = {
  sampleRate?: string;
  bitDepth?: string;
  tuningRef?: string;
  monitoring?: string;
  tempoMap?: string;
  notes?: string;
  signalChains: { track: string; mic?: string; preamp?: string; outboard?: string }[];
} | null;

/**
 * The engineering recall sheet - now editable. Shows the logged settings
 * read-only, with a quick-capture editor (calls engineeringLogs.save) so
 * engineers can record sample rate / monitoring / notes during or after the
 * session. Signal chains stay read-only here (captured elsewhere).
 */
function RecallPanel({ sessionId, log }: { sessionId: Id<"sessions">; log: RecallLog }) {
  const save = useMutation(api.engineeringLogs.save);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sampleRate: "",
    bitDepth: "",
    tuningRef: "",
    monitoring: "",
    tempoMap: "",
    notes: "",
  });

  function openEditor() {
    setForm({
      sampleRate: log?.sampleRate ?? "",
      bitDepth: log?.bitDepth ?? "",
      tuningRef: log?.tuningRef ?? "",
      monitoring: log?.monitoring ?? "",
      tempoMap: log?.tempoMap ?? "",
      notes: log?.notes ?? "",
    });
    setEditing(true);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setSaving(true);
    try {
      await save({
        sessionId,
        sampleRate: form.sampleRate.trim() || undefined,
        bitDepth: form.bitDepth.trim() || undefined,
        tuningRef: form.tuningRef.trim() || undefined,
        monitoring: form.monitoring.trim() || undefined,
        tempoMap: form.tempoMap.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success("Recall sheet saved");
      setEditing(false);
    } catch {
      toast.error("Could not save the recall sheet");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-steel">Engineering log</p>
        {!editing && (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-steel transition-colors hover:text-gold"
          >
            <NotebookPen className="size-3" />
            {log ? "Edit recall" : "Log recall"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3 rounded-md border border-graphite/50 bg-coal-2 p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sample rate">
              <Input value={form.sampleRate} onChange={set("sampleRate")} placeholder="48 kHz" />
            </Field>
            <Field label="Bit depth">
              <Input value={form.bitDepth} onChange={set("bitDepth")} placeholder="24-bit" />
            </Field>
            <Field label="Tuning">
              <Input value={form.tuningRef} onChange={set("tuningRef")} placeholder="A440" />
            </Field>
            <Field label="Monitoring">
              <Input value={form.monitoring} onChange={set("monitoring")} placeholder="NS-10" />
            </Field>
            <Field label="Tempo map">
              <Input value={form.tempoMap} onChange={set("tempoMap")} placeholder="92 BPM" />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea
              rows={3}
              value={form.notes}
              onChange={set("notes")}
              placeholder="Recall notes, patch changes, anything the next session needs."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={submit}>
              {saving && <Spinner className="text-gold-ink" />}
              {saving ? "Saving…" : "Save recall"}
            </Button>
          </div>
        </div>
      ) : !log ? (
        <p className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
          No recall sheet logged for this session yet.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-graphite/50 bg-coal-2 p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {(
              [
                ["Sample rate", log.sampleRate],
                ["Bit depth", log.bitDepth],
                ["Tuning", log.tuningRef],
                ["Monitoring", log.monitoring],
                ["Tempo map", log.tempoMap],
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
          {log.signalChains.length > 0 && (
            <div className="space-y-1 border-t border-graphite/50 pt-2">
              <p className="font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
                Signal chains
              </p>
              {log.signalChains.map((chain, i) => (
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
          {log.notes && (
            <p className="border-t border-graphite/50 pt-2 text-xs leading-relaxed text-steel">
              {log.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
