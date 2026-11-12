"use client";

import * as React from "react";
import { CalendarCheck, CheckCircle2, Circle, UserX, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TOUCH, ZuErrorState, money } from "./crm-ui";
import { useZuRead } from "./use-zu";
import { useNow } from "./inbox-clock";
import { CAL_OP } from "./calendar-ops";
import { slotDays, statusInfo, todayKey, zoneName, type SlotDay, type StatusIcon } from "./calendar-logic";
import type { AvailabilityResponse } from "./calendar-types";

/* Small pieces the Calendar screens share: the status badge (a word and an icon,
   never color alone) and the open-slot picker. */

const STATUS_ICON: Record<StatusIcon, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  confirmed: CalendarCheck,
  completed: CheckCircle2,
  no_show: UserX,
  cancelled: XCircle,
  other: Circle,
};

export function BookingStatusBadge({ status }: { status: string | null | undefined }) {
  const s = statusInfo(status);
  const Icon = STATUS_ICON[s.icon];
  return <Badge tone={s.tone}><Icon className="size-3" aria-hidden />{s.word}</Badge>;
}

const DAY_CHOICES = [7, 14, 28, 42] as const;

/** The picked slot when it is one of the open times on show, else null. A slot
 *  from an earlier calendar, option, add-on set or date range never counts. */
export function currentSlot(value: string | null, days: SlotDay[]): string | null {
  if (!value) return null;
  return days.some((d) => d.slots.some((s) => s.iso === value)) ? value : null;
}

/** Open slots from GET /v1/calendars/{id}/availability, by day in the calendar's
 *  zone. `reload` bumps to refetch (after a slot_full refusal). */
export function SlotPicker({
  calendarId,
  optionId,
  addonIds,
  value,
  onChange,
  reload = 0,
  idPrefix,
}: {
  calendarId: string;
  optionId?: string | null;
  addonIds?: string[];
  value: string | null;
  onChange: (iso: string | null) => void;
  reload?: number;
  idPrefix: string;
}) {
  const [from, setFrom] = React.useState(() => todayKey(Date.now()));
  const [days, setDays] = React.useState<number>(14);
  const now = useNow(60_000);
  const avail = useZuRead<AvailabilityResponse>(
    CAL_OP.availability,
    { path: { calendar_id: calendarId }, query: { from, days, option_id: optionId ?? undefined, addon_ids: addonIds?.length ? addonIds.join(",") : undefined } },
    // No keepPrevious: after the calendar, option, add-ons or dates change, the
    // old times must not stay on screen or clickable (F-U10).
    { kinds: ["booking"], pollMs: 300_000 },
  );
  const refresh = avail.refresh;
  const lastReload = React.useRef(reload);
  React.useEffect(() => {
    if (lastReload.current === reload) return;
    lastReload.current = reload;
    refresh();
  }, [reload, refresh]);

  const tz = avail.data?.calendar?.timezone ?? null;
  const grouped = React.useMemo(() => slotDays(avail.data?.slots, avail.data?.days, tz), [avail.data, tz]);
  // A chosen time that is not in the list on show (still loading, or gone after
  // a refetch) is cleared, so the action button cannot use it.
  const stillThere = currentSlot(value, grouped);
  React.useEffect(() => {
    if (value && !stillThere) onChange(null);
  }, [value, stillThere, onChange]);
  const quote = avail.data?.quote;
  const zone = zoneName(now, tz);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-from`}>From</Label>
          <Input id={`${idPrefix}-from`} type="date" className={cn("w-auto", TOUCH)} value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); onChange(null); } }} />
        </div>
        <div className="w-36 max-w-full space-y-1">
          <Label htmlFor={`${idPrefix}-days`}>Show</Label>
          <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); onChange(null); }}>
            <SelectTrigger id={`${idPrefix}-days`} className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>{DAY_CHOICES.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {tz && <p className="pb-2 text-xs text-steel">Times in {tz}{zone ? ` (${zone})` : ""}</p>}
      </div>

      {quote && (quote.total_cents != null || quote.length_label) && (
        <p className="text-sm text-bone">
          Quote: {quote.option?.name ?? "Service"}{quote.addons?.length ? ` + ${quote.addons.map((a) => a.name).filter(Boolean).join(", ")}` : ""}
          {quote.length_label ? ` · ${quote.length_label}` : ""}
          {quote.total_cents != null ? ` · ${money(quote.total_cents, quote.currency)}` : ""}
          {quote.deposit_cents ? ` (deposit ${money(quote.deposit_cents, quote.currency)} is not taken when booking here)` : ""}
        </p>
      )}

      {avail.error && !avail.data ? (
        <ZuErrorState error={avail.error} onRetry={avail.refresh} title="Open times did not load" />
      ) : avail.loading ? (
        <div aria-busy="true" aria-label="Loading open times" className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-2/3" /></div>
      ) : grouped.length === 0 ? (
        <p className="rounded-md border border-dashed border-graphite/60 p-3 text-sm text-steel">No open times in these days. Try a later date or more days.</p>
      ) : (
        <div role="radiogroup" aria-label="Open times" className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {grouped.map((d) => (
            <div key={d.date} className="space-y-1.5">
              <p className="text-xs font-semibold text-steel">{d.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {d.slots.map((s) => {
                  const on = s.iso === value;
                  return (
                    <button
                      key={s.iso} type="button" role="radio" aria-checked={on}
                      aria-label={`${d.label} ${s.label}`}
                      onClick={() => onChange(on ? null : s.iso)}
                      className={cn(
                        "min-h-9 rounded-md border px-2.5 text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11",
                        on ? "border-gold bg-gold font-semibold text-gold-ink" : "border-graphite/60 text-bone hover:border-gold-dim",
                      )}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {avail.error && avail.data && <p role="alert" className="text-xs text-caution">Showing the last copy. {avail.error.reason}</p>}
    </div>
  );
}
