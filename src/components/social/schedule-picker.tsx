"use client";

import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scheduleSuggestions, toDatetimeLocalValue, fromDatetimeLocalValue } from "./schedule-math";

export type ScheduleValue = { scheduledFor: number; timezone: string };

/** Date + time picker for when a post goes out, plus three one-tap
 *  suggestions (next Tue 6pm, Thu 6pm, Sat 10am) computed in the post's own
 *  timezone. A native `datetime-local` input is enough for v1; the wall-clock
 *  value it shows and accepts is always read in `value.timezone`, not the
 *  browser's own zone, so editing from a laptop in a different city does not
 *  quietly shift the studio's schedule. */
export function SchedulePicker({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  disabled?: boolean;
}) {
  const suggestions = scheduleSuggestions(Date.now(), value.timezone);
  const localValue = value.scheduledFor ? toDatetimeLocalValue(value.scheduledFor, value.timezone) : "";

  return (
    <div className="space-y-3">
      <Field label="When it goes out" hint={`Times shown in ${value.timezone}`}>
        <Input
          type="datetime-local"
          value={localValue}
          disabled={disabled}
          onChange={(e) => {
            const ts = fromDatetimeLocalValue(e.target.value, value.timezone);
            if (ts !== null) onChange({ scheduledFor: ts, timezone: value.timezone });
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <Button
            key={s.label}
            type="button"
            variant={value.scheduledFor === s.scheduledFor ? "secondary" : "outline"}
            size="sm"
            disabled={disabled}
            className={cn(value.scheduledFor === s.scheduledFor && "border-gold")}
            onClick={() => onChange({ scheduledFor: s.scheduledFor, timezone: value.timezone })}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
