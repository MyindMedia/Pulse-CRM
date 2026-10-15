"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarPlus01 as CalendarPlus,
  Check,
  Clock,
  EyeOff,
  LinkExternal01 as LinkExternal,
  Loading02 as Loader2,
  MarkerPin01 as MarkerPin,
  Repeat03 as Repeat,
  Users01 as Users,
} from "@untitledui/icons";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SESSION_SERVICE_TYPES } from "./constants";
import { cn } from "@/lib/utils";

/* "From Google": events on the studio's Google calendar that are not Pulse
   bookings yet, with everything the calendar knows about them and the room,
   client and engineer Pulse matched. Owners and managers import or ignore;
   everyone with the schedule can read. Renders nothing when the studio does
   not bring Google into Pulse or nothing is waiting. */

type Review = NonNullable<ReturnType<typeof useReview>>;
type GEvent = Review["events"][number];
type Confidence = "exact" | "strong" | "weak" | "none";

function useReview() {
  return useQuery(api.googleImport.reviewList, {});
}

const CONFIDENCE: Record<Confidence, { label: string; tone: "positive" | "info" | "caution" | "neutral" }> = {
  exact: { label: "Exact match", tone: "positive" },
  strong: { label: "Strong match", tone: "info" },
  weak: { label: "Best guess", tone: "caution" },
  none: { label: "No match", tone: "neutral" },
};

function whenLabel(e: { startTime: number; endTime: number; allDay: boolean }): string {
  const d = new Date(e.startTime);
  if (e.allDay) {
    const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    const days = Math.round((e.endTime - e.startTime) / 86_400_000);
    return days > 1 ? `${day}, all day (${days} days)` : `${day}, all day`;
  }
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const t = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(e.startTime)} to ${t(e.endTime)}`;
}

function errText(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) return typeof err.data === "string" ? err.data : fallback;
  return fallback;
}

/** The compact card on the Calendar and Schedule pages. */
export function GoogleImportCard({ className }: { className?: string }) {
  const review = useReview();
  const [open, setOpen] = React.useState(false);
  const importAll = useMutation(api.googleImport.importAllMatched);
  const [busy, setBusy] = React.useState(false);

  if (!review || !review.enabled || review.events.length === 0) return null;
  const preview = review.events.slice(0, 3);
  const confident = review.confidentCount ?? 0;

  async function runAll() {
    setBusy(true);
    try {
      const res = await importAll({});
      toast.success(
        res.imported === 0
          ? "Nothing was ready to import on its own. Review the rest."
          : `Imported ${res.imported} booking${res.imported === 1 ? "" : "s"} from Google.`,
      );
    } catch (err) {
      toast.error(errText(err, "Could not import from Google."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn("p-4 sm:p-5", className)} data-testid="google-import-card">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <CalendarPlus className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex items-center gap-2 font-grotesk text-sm font-semibold text-bone">
            From Google
            <span className="rounded-full bg-gold/15 px-2 py-0.5 font-meta text-[0.6875rem] text-gold">{review.events.length}</span>
          </p>
          <p className="mt-0.5 text-sm text-steel">
            Events on your studio Google calendar that are not bookings yet. Pulse matched the rooms, clients and engineers it
            could. Check them and import.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Review {review.events.length}
          </Button>
          {review.canManage && confident > 0 && (
            <Button size="sm" disabled={busy} onClick={runAll}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Import all with a matched room ({confident})
            </Button>
          )}
        </div>
      </div>

      <ul className="mt-4 space-y-1.5">
        {preview.map((e) => (
          <li key={e._id}>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-graphite/50 bg-coal-2/50 px-3 py-2 text-left transition-colors hover:border-gold-dim/60"
            >
              <span className="font-meta text-xs text-steel">{whenLabel(e)}</span>
              <span className="min-w-0 flex-1 basis-40 truncate text-sm text-bone">{e.title}</span>
              {e.room.roomName ? (
                <Badge tone={CONFIDENCE[e.room.confidence as Confidence].tone}>{e.room.roomName}</Badge>
              ) : (
                <Badge tone="neutral">Pick a room</Badge>
              )}
              {e.conflict && <AlertTriangle className="size-4 shrink-0 text-critical" aria-label="Room busy" />}
            </button>
          </li>
        ))}
      </ul>
      {review.events.length > preview.length && (
        <p className="mt-2 text-xs text-steel/80">and {review.events.length - preview.length} more</p>
      )}

      <GoogleImportDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** The full review list, in a centered modal. */
export function GoogleImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const review = useReview();
  const rooms = useQuery(api.rooms.bookable, open ? {} : "skip") as { _id: string; name: string }[] | undefined;
  const roster = useQuery(api.artists.roster, open ? {} : "skip") as { _id: string; name: string }[] | undefined;
  const team = useQuery(api.members.engineers, open ? {} : "skip") as { _id: string; name: string; role: string }[] | undefined;
  const importAll = useMutation(api.googleImport.importAllMatched);
  const [busy, setBusy] = React.useState(false);

  const events = review?.events ?? [];
  const confident = review?.confidentCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-w-3xl">
        <DialogHeader className="pr-12">
          <DialogTitle>From Google</DialogTitle>
          <DialogDescription>
            Upcoming events on the studio Google calendar for the next 60 days that are not Pulse bookings yet. Importing makes a
            confirmed booking that stays linked to the same Google event.
          </DialogDescription>
          {review?.canManage && confident > 0 && (
            <div className="pt-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await importAll({});
                    toast.success(`Imported ${res.imported} booking${res.imported === 1 ? "" : "s"} from Google.`);
                  } catch (err) {
                    toast.error(errText(err, "Could not import from Google."));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Import all with a matched room ({confident})
              </Button>
            </div>
          )}
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-3">
          {review === undefined ? (
            <p className="text-sm text-steel/70">Loading events…</p>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-sm text-steel/70">Nothing waiting. Everything on the Google calendar is in Pulse.</p>
          ) : (
            events.map((e) => (
              <EventRow
                key={e._id}
                event={e}
                canManage={review.canManage}
                rooms={rooms ?? []}
                roster={roster ?? []}
                team={team ?? []}
              />
            ))
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const NONE = "__none__";
const NEW = "__new__";

function EventRow({
  event: e,
  canManage,
  rooms,
  roster,
  team,
}: {
  event: GEvent;
  canManage: boolean;
  rooms: { _id: string; name: string }[];
  roster: { _id: string; name: string }[];
  team: { _id: string; name: string; role: string }[];
}) {
  const importEvent = useMutation(api.googleImport.importEvent);
  const ignoreEvent = useMutation(api.googleImport.ignoreEvent);
  const unignore = useMutation(api.googleImport.unignoreEvent);
  const [busy, setBusy] = React.useState<"import" | "ignore" | null>(null);
  const [showDesc, setShowDesc] = React.useState(false);

  const matchedRoom = e.room.roomId ?? NONE;
  const [roomId, setRoomId] = React.useState<string>(matchedRoom);
  const clientDefault = e.client.kind === "existing" ? e.client.artistId : NEW;
  const [clientId, setClientId] = React.useState<string>(clientDefault);
  const [newName, setNewName] = React.useState(e.client.kind === "new" ? e.client.name : "");
  const [newEmail, setNewEmail] = React.useState(e.client.kind === "new" ? (e.client.email ?? "") : "");
  const [engineerId, setEngineerId] = React.useState<string>(e.engineer?.memberId ?? NONE);
  const [service, setService] = React.useState<string>("recording");

  // A room picked by hand gets its own conflict check.
  const picked = roomId !== matchedRoom && roomId !== NONE;
  const pickedConflict = useQuery(
    api.googleImport.conflictFor,
    picked ? { eventId: e._id, roomId: roomId as Id<"rooms"> } : "skip",
  );
  const conflict = roomId === NONE ? null : picked ? (pickedConflict ?? null) : e.conflict;
  const clientReady = clientId !== NEW || newName.trim() !== "";

  async function doImport() {
    setBusy("import");
    try {
      await importEvent({
        eventId: e._id,
        roomId: roomId === NONE ? null : (roomId as Id<"rooms">),
        ...(clientId === NEW
          ? { newClient: { name: newName.trim(), email: newEmail.trim() || undefined } }
          : { artistId: clientId as Id<"artists"> }),
        engineerId: engineerId === NONE ? null : (engineerId as Id<"members">),
        serviceType: service as (typeof SESSION_SERVICE_TYPES)[number],
        customService: service === "custom" ? "Google booking" : undefined,
      });
      toast.success(`${e.title} is now a booking.`);
    } catch (err) {
      toast.error(errText(err, "Could not import this event."));
      setBusy(null);
    }
  }

  async function doIgnore() {
    setBusy("ignore");
    try {
      await ignoreEvent({ eventId: e._id });
      toast(`Hid ${e.title}.`, {
        action: { label: "Undo", onClick: () => void unignore({ eventId: e._id }) },
      });
    } catch (err) {
      toast.error(errText(err, "Could not hide this event."));
      setBusy(null);
    }
  }

  const guests = e.attendees.filter((a) => !a.resource && !a.self);
  const resources = e.attendees.filter((a) => a.resource);
  const conf = CONFIDENCE[e.room.confidence as Confidence];

  return (
    <article className="min-w-0 rounded-lg border border-graphite/50 bg-coal-2/50 p-3 sm:p-4" data-testid="google-event-row">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-60">
          <h3 className="break-words font-grotesk text-sm font-semibold text-bone">{e.title}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-steel">
            <Clock className="size-3.5 shrink-0" />
            {whenLabel(e)}
            {e.recurring && (
              <span className="inline-flex items-center gap-1 text-steel/80">
                <Repeat className="size-3" /> repeats
              </span>
            )}
            {e.status === "tentative" && <Badge tone="caution">Tentative</Badge>}
          </p>
        </div>
        {e.htmlLink && (
          <a
            href={e.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-gold hover:underline"
          >
            Open in Google <LinkExternal className="size-3" />
          </a>
        )}
      </header>

      <dl className="mt-3 space-y-1.5 text-xs">
        {e.location && (
          <div className="flex min-w-0 gap-1.5 text-steel">
            <MarkerPin className="mt-0.5 size-3.5 shrink-0" />
            <dd className="min-w-0 break-words text-bone/90">{e.location}</dd>
          </div>
        )}
        {(guests.length > 0 || e.organizerEmail) && (
          <div className="flex min-w-0 gap-1.5 text-steel">
            <Users className="mt-0.5 size-3.5 shrink-0" />
            <dd className="min-w-0 space-y-0.5">
              {e.organizerEmail && (
                <p className="break-all text-steel">
                  Organizer: <span className="text-bone/90">{e.organizerName ? `${e.organizerName} (${e.organizerEmail})` : e.organizerEmail}</span>
                </p>
              )}
              {guests.length > 0 && (
                <ul className="flex flex-wrap gap-1">
                  {guests.map((g, i) => (
                    <li
                      key={`${g.email ?? g.name}-${i}`}
                      className="max-w-full break-all rounded border border-graphite/50 bg-obsidian/60 px-1.5 py-0.5 text-[0.6875rem] text-bone/90"
                    >
                      {g.name ? `${g.name}${g.email ? ` · ${g.email}` : ""}` : g.email}
                      {g.responseStatus && g.responseStatus !== "needsAction" && (
                        <span className="ml-1 text-steel/80">({g.responseStatus === "accepted" ? "yes" : g.responseStatus === "declined" ? "no" : "maybe"})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        )}
        {resources.length > 0 && (
          <p className="text-steel">
            Room resource: <span className="text-bone/90">{resources.map((r) => r.name ?? r.email).join(", ")}</span>
          </p>
        )}
        {e.description && (
          <div>
            <p className={cn("whitespace-pre-wrap break-words text-steel", !showDesc && "line-clamp-3")}>{e.description}</p>
            {e.description.length > 180 && (
              <button type="button" className="mt-0.5 text-gold hover:underline" onClick={() => setShowDesc((s) => !s)}>
                {showDesc ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        )}
      </dl>

      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-graphite/40 pt-3 sm:grid-cols-2">
        <Field label="Room" hint={e.room.reason}>
          <div className="flex min-w-0 items-center gap-2">
            {canManage ? (
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger className="min-w-0 flex-1">
                  <SelectValue placeholder="Pick a room" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No room</SelectItem>
                  {rooms.map((r) => (
                    <SelectItem key={r._id} value={r._id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm text-bone">{e.room.roomName ?? "No room matched"}</span>
            )}
            {!picked && <Badge tone={conf.tone} className="shrink-0">{conf.label}</Badge>}
          </div>
        </Field>

        <Field
          label="Client"
          hint={
            e.client.kind === "existing"
              ? e.client.via === "email"
                ? "Matched by a guest's email."
                : "Matched by the name in the title."
              : e.client.kind === "new"
                ? "New client from the guest list."
                : "No client on the event. Pick one or add a new client."
          }
        >
          {canManage ? (
            <div className="space-y-2">
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="min-w-0">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW}>New client</SelectItem>
                  {roster.map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {clientId === NEW && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input aria-label="New client name" placeholder="Name" value={newName} onChange={(ev) => setNewName(ev.target.value)} />
                  <Input aria-label="New client email" placeholder="Email (optional)" type="email" value={newEmail} onChange={(ev) => setNewEmail(ev.target.value)} />
                </div>
              )}
            </div>
          ) : (
            <span className="text-sm text-bone">
              {e.client.kind === "existing" ? e.client.name : e.client.kind === "new" ? `${e.client.name} (new)` : "None"}
            </span>
          )}
        </Field>

        <Field label="Engineer" hint={e.engineer ? "On the guest list." : undefined}>
          {canManage ? (
            <Select value={engineerId} onValueChange={setEngineerId}>
              <SelectTrigger className="min-w-0">
                <SelectValue placeholder="No engineer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No engineer</SelectItem>
                {team.map((m) => (
                  <SelectItem key={m._id} value={m._id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-bone">{e.engineer?.name ?? "None"}</span>
          )}
        </Field>

        {canManage && (
          <Field label="Service">
            <Select value={service} onValueChange={setService}>
              <SelectTrigger className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SESSION_SERVICE_TYPES.filter((s) => s !== "custom").map((s) => (
                  <SelectItem key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {conflict && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-critical" role="status">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {conflict.message}
        </p>
      )}

      {canManage && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={doIgnore}>
            {busy === "ignore" ? <Loader2 className="size-3.5 animate-spin" /> : <EyeOff className="size-3.5" />}
            Ignore
          </Button>
          <Button size="sm" disabled={busy !== null || Boolean(conflict) || !clientReady} onClick={doImport}>
            {busy === "import" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Import
          </Button>
        </div>
      )}
    </article>
  );
}
