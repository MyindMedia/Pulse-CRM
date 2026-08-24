"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { ClientPicker, type ClientValue } from "@/components/bookings/client-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { money, duration } from "@/lib/format";
import { serviceLabel, titleCase } from "@/lib/labels";
import {
  SESSION_SERVICE_TYPES,
  combineDateTime,
  toDateInputValue,
} from "./constants";

const STEP_LABELS = ["Artist", "Service", "Schedule", "Rate"];
const DURATIONS = [
  { label: "1 hour", mins: 60 },
  { label: "2 hours", mins: 120 },
  { label: "3 hours", mins: 180 },
  { label: "4 hours", mins: 240 },
  { label: "6 hours", mins: 360 },
  { label: "8 hours", mins: 480 },
];

/** A prior session distilled to the fields worth carrying into a rebook, so
 *  booking a regular is just picking a new date + time. */
export type SessionPrefill = {
  artistId?: string;
  artistName: string;
  serviceType?: string;
  customService?: string;
  roomId?: string;
  engineerId?: string;
  songId?: string;
  rateCents?: number;
  title?: string;
};

/** Multi-step session booking modal. Submits to sessions.create. */
export function BookSessionDialog({
  open,
  onOpenChange,
  initialDate,
  prefillFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: number;
  /** Seed the dialog from a prior session (one-tap rebook). */
  prefillFrom?: SessionPrefill;
}) {
  const rooms = useQuery(api.rooms.bookable);
  const engineers = useQuery(api.members.engineers);
  const create = useMutation(api.sessions.create);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1 - client is either an existing artist (artistId set) or a new name.
  const [client, setClient] = useState<ClientValue>({ name: "" });
  const [songId, setSongId] = useState("");
  // Step 2
  const [serviceType, setServiceType] = useState<string>("recording");
  /* The studio's own name for a booking that is not one of the seven services:
     a tour, a maintenance day, a hold. The category is only useful if it says
     what it is, so step 2 does not pass without it. */
  const [customService, setCustomService] = useState("");
  const [roomId, setRoomId] = useState("");
  const [engineerId, setEngineerId] = useState("");
  // Step 3
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
  const [durationMins, setDurationMins] = useState(120);
  // Step 4
  const [title, setTitle] = useState("");
  const [rate, setRate] = useState("");
  const [deposit, setDeposit] = useState("");

  const songs = useQuery(
    api.songs.picker,
    client.artistId ? { artistId: client.artistId as Id<"artists"> } : {},
  );

  /* Schedule-aware start times: with a room chosen, the same availability
     the public booking page uses (hourly slots, past times excluded, booked
     blocks returned) drives a slot picker - taken or too-short windows are
     greyed out; without a room we can only enforce "not in the past". */
  const OPEN_HOUR = 9;
  const CLOSE_HOUR = 22;
  const dayStart = date ? combineDateTime(date, "00:00") : null;
  const availability = useQuery(
    api.booking.availability,
    roomId && dayStart !== null
      ? { roomId: roomId as Id<"rooms">, dayStart }
      : "skip",
  );

  type Slot = { hour: number; startTime: number; available: boolean };
  const slots: Slot[] = useMemo(() => {
    if (dayStart === null) return [];
    const now = Date.now();
    const durMs = durationMins * 60_000;
    if (roomId && availability) {
      return availability.slots.map((sl) => ({
        hour: sl.hour,
        startTime: sl.startTime,
        available:
          sl.available &&
          !availability.booked.some((b) => b.start < sl.startTime + durMs && b.end > sl.startTime),
      }));
    }
    // No room picked: no conflicts to check - just never offer the past.
    const out: Slot[] = [];
    for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
      const startTime = dayStart + h * 3_600_000;
      out.push({ hour: h, startTime, available: startTime > now });
    }
    return out;
  }, [dayStart, roomId, availability, durationMins]);

  // Keep the selection legal: whenever the day/room/duration changes and the
  // chosen time is gone (past, taken, or unset), snap to the NEXT open slot.
  const slotsLoading = Boolean(roomId && dayStart !== null && availability === undefined);
  useEffect(() => {
    if (dayStart === null || slotsLoading || slots.length === 0) return;
    const selected = time ? combineDateTime(date, time) : null;
    const selectedSlot = slots.find((sl) => sl.startTime === selected);
    if (selectedSlot?.available) return;
    const next = slots.find((sl) => sl.available);
    if (next) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snapping an invalid selection to schedule data
      setTime(`${String(next.hour).padStart(2, "0")}:00`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart, roomId, durationMins, slotsLoading, slots.length]);

  const selectedStart = date && time ? combineDateTime(date, time) : null;
  const selectedSlotOk = slots.some((sl) => sl.startTime === selectedStart && sl.available);

  function reset() {
    setStep(0);
    setClient({ name: "" });
    setSongId("");
    setServiceType("recording");
    setRoomId("");
    setEngineerId("");
    setDate("");
    setTime("12:00");
    setDurationMins(120);
    setTitle("");
    setRate("");
    setCustomService("");
    setDeposit("");
  }

  // Seed the date when the modal opens - needs a fresh "now" per open, so
  // we read Date.now() inside the open-transition branch.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      // eslint-disable-next-line react-hooks/purity -- one-shot "today" snapshot on open transition
      setDate(toDateInputValue(initialDate ?? Date.now()));
      // One-tap rebook: carry the client / service / room / engineer / rate
      // from a prior session so only the new date + time remain to choose.
      if (prefillFrom) {
        setClient({ artistId: prefillFrom.artistId, name: prefillFrom.artistName });
        if (prefillFrom.songId) setSongId(prefillFrom.songId);
        if (prefillFrom.serviceType) setServiceType(prefillFrom.serviceType);
        if (prefillFrom.customService) setCustomService(prefillFrom.customService);
        if (prefillFrom.roomId) setRoomId(prefillFrom.roomId);
        if (prefillFrom.engineerId) setEngineerId(prefillFrom.engineerId);
        if (prefillFrom.title) setTitle(prefillFrom.title);
        if (prefillFrom.rateCents && prefillFrom.rateCents > 0) {
          setRate(String(prefillFrom.rateCents / 100));
        }
      }
    }
  }

  const artistName = client.name;

  const rateCents = Math.round((parseFloat(rate) || 0) * 100);
  const depositCents = Math.round((parseFloat(deposit) || 0) * 100);

  const stepValid: boolean[] = [
    client.name.trim() !== "",
    serviceType !== "" && (serviceType !== "custom" || customService.trim() !== ""),
    date !== "" && time !== "" && durationMins > 0 && selectedSlotOk,
    title.trim().length > 0 && rateCents > 0 && depositCents <= rateCents,
  ];

  const isLast = step === 3;

  async function submit() {
    if (!stepValid.every(Boolean)) return;
    const startTime = combineDateTime(date, time);
    const endTime = startTime + durationMins * 60_000;
    setSaving(true);
    try {
      await create({
        title: title.trim(),
        artistId: client.artistId ? (client.artistId as Id<"artists">) : undefined,
        clientName: client.artistId ? undefined : client.name.trim(),
        clientEmail: client.artistId ? undefined : client.email?.trim() || undefined,
        clientPhone: client.artistId ? undefined : client.phone?.trim() || undefined,
        songId: songId ? (songId as Id<"songs">) : undefined,
        serviceType: serviceType as
          | "recording"
          | "mixing"
          | "mastering"
          | "production"
          | "consultation"
          | "rehearsal"
          | "writing"
          | "custom",
        customService: serviceType === "custom" ? customService.trim() : undefined,
        roomId: roomId ? (roomId as Id<"rooms">) : undefined,
        engineerId: engineerId ? (engineerId as Id<"members">) : undefined,
        startTime,
        endTime,
        rateCents,
        depositCents: depositCents > 0 ? depositCents : undefined,
      });
      toast.success("Session booked - held as tentative");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Could not book the session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Book a session</DialogTitle>
          <DialogDescription>
            Step {step + 1} of 4 - {STEP_LABELS[step]}
          </DialogDescription>
        </DialogHeader>

        {/* Step rail */}
        <div className="flex items-center gap-1.5 px-5 pt-4">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full font-meta text-[0.625rem] font-bold",
                  i < step && "bg-positive/20 text-positive",
                  i === step && "bg-gold text-gold-ink",
                  i > step && "bg-coal-2 text-steel/70",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <span
                  className={cn(
                    "h-px flex-1",
                    i < step ? "bg-positive/40" : "bg-hairline",
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <DialogBody className="space-y-4">
          {/* Step 1 - Artist + song */}
          {step === 0 && (
            <>
              <ClientPicker
                value={client}
                autoFocus
                onChange={(v) => {
                  if (v.artistId !== client.artistId) setSongId("");
                  setClient(v);
                }}
              />

              <Field label="Song" hint="Link a catalog song - optional.">
                <Select
                  value={songId}
                  onValueChange={setSongId}
                  disabled={!client.artistId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !client.artistId
                          ? "Existing clients only"
                          : songs && songs.length === 0
                            ? "No songs for this artist"
                            : "Select a song"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(songs ?? []).map((s) => (
                      <SelectItem key={s._id} value={s._id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          {/* Step 2 - Service / room / engineer */}
          {step === 1 && (
            <>
              <Field label="Service type">
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SESSION_SERVICE_TYPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s === "custom" ? "Custom category…" : titleCase(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Not every booking is a session. A tour, a maintenance day, a
                  hold on the room - the studio names it and the calendar says
                  that name instead of squeezing it into "consultation". */}
              {serviceType === "custom" && (
                <Field
                  label="Category name"
                  htmlFor="sess-custom"
                  hint="What this is called on the calendar."
                >
                  <Input
                    id="sess-custom"
                    value={customService}
                    onChange={(e) => setCustomService(e.target.value)}
                    placeholder="Tour, maintenance, blocked…"
                    maxLength={40}
                    autoFocus
                  />
                </Field>
              )}

              <Field label="Room" hint="Where the session runs - optional.">
                <Select value={roomId} onValueChange={setRoomId}>
                  <SelectTrigger>
                    <SelectValue placeholder={rooms ? "Select a room" : "Loading rooms…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(rooms ?? []).map((r) => (
                      <SelectItem key={r._id} value={r._id}>
                        {r.name}{r.roomType ? ` · ${r.roomType}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Engineer" hint="Assigned engineer - optional.">
                <Select value={engineerId} onValueChange={setEngineerId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={engineers ? "Select an engineer" : "Loading team…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(engineers ?? []).map((e) => (
                      <SelectItem key={e._id} value={e._id}>
                        {e.name} · {titleCase(e.role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          {/* Step 3 - Date / time / duration */}
          {step === 2 && (
            <>
              <Field label="Date" htmlFor="sess-date">
                <Input
                  id="sess-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>

              <Field
                label="Start time"
                hint={
                  roomId
                    ? "Open times for the room - booked and past slots are greyed out."
                    : "Pick a room in the previous step to see live availability; past times are disabled."
                }
              >
                {slotsLoading ? (
                  <p className="py-3 text-center text-xs text-steel/70">Checking the schedule…</p>
                ) : slots.length === 0 ? (
                  <p className="py-3 text-center text-xs text-steel/70">Pick a date first.</p>
                ) : slots.every((sl) => !sl.available) ? (
                  <p className="rounded-md border border-dashed border-graphite/60 py-3 text-center text-xs text-steel/70">
                    No open times this day - try the next day or another room.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                    {slots.map((sl) => {
                      const label = new Date(sl.startTime).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      });
                      const isSelected = selectedStart === sl.startTime;
                      return (
                        <button
                          key={sl.hour}
                          type="button"
                          disabled={!sl.available}
                          onClick={() => setTime(`${String(sl.hour).padStart(2, "0")}:00`)}
                          className={cn(
                            "rounded-md border px-2 py-1.5 font-meta text-xs transition-colors",
                            isSelected
                              ? "border-gold/60 bg-gold/15 text-gold"
                              : sl.available
                                ? "border-graphite/50 bg-coal-2 text-bone hover:border-graphite/70"
                                : "cursor-not-allowed border-graphite/30 bg-coal text-steel/30 line-through",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>

              <Field label="Duration">
                <Select
                  value={String(durationMins)}
                  onValueChange={(v) => setDurationMins(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((d) => (
                      <SelectItem key={d.mins} value={String(d.mins)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {date && time && (
                <p className="rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-xs text-steel">
                  Runs until{" "}
                  <span className="font-meta text-bone">
                    {new Date(
                      combineDateTime(date, time) + durationMins * 60_000,
                    ).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>{" "}
                  ({duration(0, durationMins * 60_000)} total).
                </p>
              )}
            </>
          )}

          {/* Step 4 - Title / rate / deposit */}
          {step === 3 && (
            <>
              <Field label="Session title" htmlFor="sess-title">
                <Input
                  id="sess-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    serviceType === "custom"
                      ? serviceLabel(serviceType, customService)
                      : `${titleCase(serviceType)} session`
                  }
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Rate (USD)" htmlFor="sess-rate">
                  <Input
                    id="sess-rate"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="600"
                  />
                </Field>
                <Field
                  label="Deposit (USD)"
                  htmlFor="sess-deposit"
                  hint="Optional - cannot exceed the rate."
                >
                  <Input
                    id="sess-deposit"
                    inputMode="decimal"
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="150"
                  />
                </Field>
              </div>

              {depositCents > rateCents && rateCents > 0 && (
                <p className="text-[0.6875rem] text-critical">
                  The deposit cannot be larger than the session rate.
                </p>
              )}

              {/* Booking summary */}
              <div className="space-y-1.5 rounded-md border border-graphite/50 bg-coal-2 p-3">
                <p className="overline">Summary</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="gold">{artistName || "Artist"}</Badge>
                  <Badge tone="neutral">{serviceLabel(serviceType, customService)}</Badge>
                  {date && (
                    <Badge tone="info">
                      {new Date(combineDateTime(date, time)).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </Badge>
                  )}
                  <Badge tone="neutral">{duration(0, durationMins * 60_000)}</Badge>
                </div>
                {rateCents > 0 && (
                  <p className="font-meta text-xs text-steel">
                    Rate {money(rateCents)}
                    {depositCents > 0 ? ` · deposit ${money(depositCents)}` : ""}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={saving}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          <div className="flex-1" />
          {isLast ? (
            <Button onClick={submit} disabled={!stepValid[step] || saving}>
              {saving && <Spinner className="text-gold-ink" />}
              {saving ? "Booking…" : "Confirm booking"}
            </Button>
          ) : (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!stepValid[step]}
            >
              Continue
              <ArrowRight className="size-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
