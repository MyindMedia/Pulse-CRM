"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Clock, MessageTextSquare01, Star01, Plus, Trash01 } from "@untitledui/icons";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  describeWindow,
  offPeakWindowError,
  OFF_PEAK_MAX_WINDOWS,
  type OffPeakWindow,
} from "@convex/lib/offPeak";

/* Settings > Growth: off-peak pricing, fill-the-gap deal texts, the Google
   review link (convex/growth.ts). Each control saves on its own. */

const DAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 25 }, (_, h) => h);

function hourLabel(h: number) {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function errorText(e: unknown, fallback: string) {
  if (e && typeof e === "object" && "data" in e) {
    const data = (e as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return e instanceof Error ? e.message : fallback;
}

function SectionIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
      {children}
    </span>
  );
}

export function GrowthPanel() {
  const data = useQuery(api.growth.get);
  const set = useMutation(api.growth.set);
  const [pending, setPending] = React.useState<string | null>(null);

  async function save(key: string, patch: Parameters<typeof set>[0], ok: string) {
    setPending(key);
    try {
      await set(patch);
      toast.success(ok);
    } catch (e) {
      toast.error(errorText(e, "Could not save that."));
    } finally {
      setPending(null);
    }
  }

  if (data === undefined) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Off-peak pricing ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <SectionIcon><Clock className="size-4" aria-hidden /></SectionIcon>
            <div className="min-w-0 flex-1">
              <CardTitle>Off-peak pricing</CardTitle>
              <CardDescription>
                A lower room rate for quiet hours, set per room. Clients see it on your booking page.
                A promo code never stacks with it: the client pays whichever is lower.
              </CardDescription>
            </div>
            <Switch
              aria-label="Off-peak pricing"
              checked={data.offPeakEnabled}
              disabled={!data.canEditPricing || pending === "offPeak"}
              onCheckedChange={(on) =>
                save("offPeak", { offPeakEnabled: on }, `Off-peak pricing is ${on ? "on" : "off"}.`)
              }
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.canEditPricing && (
            <p className="text-xs text-steel">Only someone who sets prices can change off-peak pricing.</p>
          )}
          {data.rooms.length === 0 ? (
            <p className="text-sm text-steel">Add a room first.</p>
          ) : (
            data.rooms.map((room) => (
              <RoomWindows
                key={room._id}
                roomId={room._id}
                name={room.name}
                saved={room.offPeakWindows}
                disabled={!data.canEditPricing}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* ── Deal texts ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <SectionIcon><MessageTextSquare01 className="size-4" aria-hidden /></SectionIcon>
            <div className="min-w-0 flex-1">
              <CardTitle>Fill-the-gap deal texts</CardTitle>
              <CardDescription>
                Each morning the Pulse agent looks at tomorrow. When a room has 3 or more free hours
                and it thinks a text could fill them, it drafts one to clients who opted in to deals.
              </CardDescription>
            </div>
            <Switch
              aria-label="Deal texts"
              checked={data.dealTexts.enabled}
              disabled={pending === "deals"}
              onCheckedChange={(on) =>
                save(
                  "deals",
                  { dealTexts: { enabled: on, mode: data.dealTexts.mode } },
                  `Deal texts are ${on ? "on" : "off"}.`,
                )
              }
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.dealTexts.live && (
            <p className="rounded-md border border-gold-dim/40 bg-gold/10 px-3 py-2 text-xs text-steel">
              Waiting on carrier approval for marketing texts. You can set this up now: nothing is
              drafted or sent until approval lands, and opt-ins are already being collected.
            </p>
          )}
          <div role="radiogroup" aria-label="Who sends" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                { mode: "approve", label: "Approve each", blurb: "Every draft waits in your Inbox. Nothing sends until you approve it." },
                { mode: "auto", label: "Auto", blurb: "Texts the agent is confident about send on their own. The rest wait in your Inbox." },
              ] as const
            ).map((o) => {
              const active = data.dealTexts.mode === o.mode;
              return (
                <button
                  key={o.mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={pending === "deals"}
                  onClick={() =>
                    !active &&
                    save("deals", { dealTexts: { enabled: data.dealTexts.enabled, mode: o.mode } }, `${o.label} selected.`)
                  }
                  className={cn(
                    "rounded-lg border px-4 py-3 text-left transition-colors",
                    active ? "border-gold bg-gold/10" : "border-graphite/50 bg-coal/40 hover:border-gold-dim",
                  )}
                >
                  <span className="font-grotesk text-sm font-semibold text-bone">{o.label}</span>
                  <span className="mt-1 block text-xs text-steel">{o.blurb}</span>
                </button>
              );
            })}
          </div>
          <ul className="space-y-1 text-xs text-steel">
            <li>
              {data.dealsOptedIn} client{data.dealsOptedIn === 1 ? "" : "s"} opted in so far, from the box on your
              booking page or by texting DEALS.
            </li>
            <li>Texts go out between 10am and 7pm, at most once every 8 days per client. STOP always wins.</li>
            <li>A draft is dropped if the time gets booked before it sends.</li>
          </ul>
        </CardContent>
      </Card>

      {/* ── Google reviews ── */}
      <GoogleReviewCard
        saved={data.googleReviewUrl}
        linked={data.googleLinked}
        busy={pending === "google"}
        onSave={(url) => save("google", { googleReviewUrl: url }, url ? "Google review link saved." : "Google review link removed.")}
      />
    </div>
  );
}

function GoogleReviewCard({
  saved,
  linked,
  busy,
  onSave,
}: {
  saved: string;
  linked: boolean;
  busy: boolean;
  onSave: (url: string) => void;
}) {
  const [url, setUrl] = React.useState(saved);
  const [prevSaved, setPrevSaved] = React.useState(saved);
  if (prevSaved !== saved) {
    setPrevSaved(saved);
    setUrl(saved);
  }
  const dirty = url.trim() !== saved;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <SectionIcon><Star01 className="size-4" aria-hidden /></SectionIcon>
          <div className="min-w-0">
            <CardTitle>Google reviews</CardTitle>
            <CardDescription>
              After a session Pulse asks the client for a 1 to 5 rating by text. With a link here, every
              client who answers also gets your Google review link, whatever they rated. Google does not
              allow asking only happy clients.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {linked ? (
          <p className="text-sm text-steel">
            Your Google Listing sets this link.{" "}
            <a href="/settings?tab=integrations" className="text-gold underline-offset-2 hover:underline">
              Manage it in Integrations
            </a>
            .
          </p>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              onSave(url.trim());
            }}
          >
            <div className="min-w-0 flex-1">
              <Field
                label="Review link"
                htmlFor="google-review-url"
                hint="From your Google Business Profile: Ask for reviews, then copy the link."
              >
                <Input
                  id="google-review-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://g.page/r/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" disabled={!dirty || busy} className="shrink-0">
              Save
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RoomWindows({
  roomId,
  name,
  saved,
  disabled,
}: {
  roomId: Id<"rooms">;
  name: string;
  saved: OffPeakWindow[];
  disabled: boolean;
}) {
  const setWindows = useMutation(api.growth.setRoomWindows);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = React.useState<OffPeakWindow[]>(saved);
  const [prevKey, setPrevKey] = React.useState(savedKey);
  if (prevKey !== savedKey) {
    setPrevKey(savedKey);
    setDraft(saved);
  }
  const [busy, setBusy] = React.useState(false);
  const dirty = JSON.stringify(draft) !== savedKey;
  const firstError = draft.map(offPeakWindowError).find(Boolean) ?? null;

  function patch(i: number, next: Partial<OffPeakWindow>) {
    setDraft((d) => d.map((w, j) => (j === i ? { ...w, ...next } : w)));
  }

  async function save() {
    setBusy(true);
    try {
      await setWindows({ roomId, windows: draft });
      toast.success(`Off-peak saved for ${name}.`);
    } catch (e) {
      toast.error(errorText(e, "Could not save those windows."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-grotesk text-sm font-semibold text-bone">{name}</p>
        <p className="text-xs text-steel">
          {saved.length ? saved.map(describeWindow).join("; ") : "No off-peak hours"}
        </p>
      </div>

      {draft.map((w, i) => (
        <div key={i} className="space-y-2 rounded-md border border-graphite/40 bg-coal-2/60 p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
            {DAY_LETTERS.map((d, day) => {
              const on = w.days.includes(day);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() =>
                    patch(i, { days: on ? w.days.filter((x) => x !== day) : [...w.days, day].sort((a, b) => a - b) })
                  }
                  className={cn(
                    "h-8 min-w-11 rounded-md border px-2 font-meta text-xs transition-colors",
                    on ? "border-gold bg-gold text-gold-ink" : "border-graphite/60 text-steel hover:border-gold-dim",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="space-y-1 text-xs text-steel">
              <span>From</span>
              <select
                className="h-10 w-full rounded-md border border-graphite/60 bg-coal px-2 text-sm text-bone"
                value={w.startHour}
                disabled={disabled}
                onChange={(e) => patch(i, { startHour: Number(e.target.value) })}
              >
                {HOURS.slice(0, 24).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-steel">
              <span>Until</span>
              <select
                className="h-10 w-full rounded-md border border-graphite/60 bg-coal px-2 text-sm text-bone"
                value={w.endHour}
                disabled={disabled}
                onChange={(e) => patch(i, { endHour: Number(e.target.value) })}
              >
                {HOURS.slice(1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-steel">
              <span>Percent off</span>
              <Input
                type="number"
                min={1}
                max={90}
                value={w.pct}
                disabled={disabled}
                onChange={(e) => patch(i, { pct: Number(e.target.value) })}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove window"
              disabled={disabled}
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
            >
              <Trash01 className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      {firstError && <p className="text-xs text-critical">{firstError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || draft.length >= OFF_PEAK_MAX_WINDOWS}
          onClick={() => setDraft((d) => [...d, { days: [1, 2, 3, 4], startHour: 10, endHour: 14, pct: 20 }])}
        >
          <Plus className="size-4" /> Add window
        </Button>
        {dirty && (
          <Button type="button" size="sm" disabled={disabled || busy || !!firstError} onClick={() => void save()}>
            Save {name}
          </Button>
        )}
      </div>
    </div>
  );
}
