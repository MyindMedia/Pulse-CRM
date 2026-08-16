"use client";

import * as React from "react";
import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export type CableLabelMode = "single" | "perEnd";

/** "Apollo x8p · Monitor Out L" -> "Apollo x8p". */
export function shortDeviceName(full?: string) {
  return (full ?? "this end").split(" · ")[0];
}

/** The label a cable carries at one end names the device at the OTHER end,
    because that is the question someone is asking when they read it. */
export function suggestedEndLabels(source?: string, target?: string) {
  return {
    atSource: `OUT TO ${shortDeviceName(target).toUpperCase()}`,
    atTarget: `IN FROM ${shortDeviceName(source).toUpperCase()}`,
  };
}

/**
 * How a run is labelled.
 *
 * A cable is usually marked in three places: once in the middle saying
 * what it is, and once at each end saying where the other end goes. Those
 * are different strings on purpose, which is why "one label" and "a label
 * per end" are a real choice rather than a formatting preference.
 *
 * Shared by the picker that appears on drop and the Cable Run panel, so
 * the two can never disagree about what the options are.
 */
export function CableLabelFields({
  mode,
  onModeChange,
  tag,
  onTagChange,
  sourceTag,
  onSourceTagChange,
  targetTag,
  onTargetTagChange,
  sourceName,
  targetName,
  disabled,
  onCommit,
}: {
  mode: CableLabelMode;
  onModeChange: (mode: CableLabelMode) => void;
  tag: string;
  onTagChange: (value: string) => void;
  sourceTag: string;
  onSourceTagChange: (value: string) => void;
  targetTag: string;
  onTargetTagChange: (value: string) => void;
  sourceName?: string;
  targetName?: string;
  disabled?: boolean;
  /**
   * Called when a field loses focus, for panels that save as you go.
   * Takes an explicit patch because React state has not updated yet when a
   * button both sets values and commits in the same handler.
   */
  onCommit?: (next?: {
    mode?: CableLabelMode;
    tag?: string;
    sourceTag?: string;
    targetTag?: string;
  }) => void;
}) {
  const suggested = suggestedEndLabels(sourceName, targetName);

  return (
    <div className="space-y-2 rounded-chrome border border-hairline-2 bg-coal-2/40 p-3">
      <p className="overline">Labelling</p>

      <div className="flex items-center gap-1 rounded-md border border-hairline-2 bg-coal p-1">
        {(
          [
            { key: "single", label: "One label" },
            { key: "perEnd", label: "Label each end" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => {
              onModeChange(key);
              onCommit?.({ mode: key });
            }}
            aria-pressed={mode === key}
            className={cn(
              "flex-1 rounded-[6px] px-2 py-1 font-meta text-[10px] uppercase tracking-wide transition-colors disabled:opacity-40",
              mode === key ? "bg-gold/15 text-gold-bright" : "text-steel hover:text-bone",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "single" ? (
        <Field
          label="Physical label"
          hint="What is written on the cable. This is what someone reads off the run list at 2am."
        >
          <Input
            value={tag}
            disabled={disabled}
            onChange={(event) => onTagChange(event.target.value)}
            onBlur={() => onCommit?.()}
            placeholder="A-014"
            className="h-9 text-xs"
          />
        </Field>
      ) : (
        <div className="space-y-2">
          <Field label={`At ${shortDeviceName(sourceName)}`}>
            <Input
              value={sourceTag}
              disabled={disabled}
              onChange={(event) => onSourceTagChange(event.target.value)}
              onBlur={() => onCommit?.()}
              placeholder={suggested.atSource}
              className="h-9 text-xs"
            />
          </Field>
          <Field label={`At ${shortDeviceName(targetName)}`}>
            <Input
              value={targetTag}
              disabled={disabled}
              onChange={(event) => onTargetTagChange(event.target.value)}
              onBlur={() => onCommit?.()}
              placeholder={suggested.atTarget}
              className="h-9 text-xs"
            />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={disabled}
            onClick={() => {
              onSourceTagChange(suggested.atSource);
              onTargetTagChange(suggested.atTarget);
              // Pass the values through: the state set above is not visible
              // to this handler yet, so committing without them would save
              // whatever was there before.
              onCommit?.({ sourceTag: suggested.atSource, targetTag: suggested.atTarget });
            }}
          >
            <Tag className="size-3.5" />
            Use suggested end labels
          </Button>
        </div>
      )}
    </div>
  );
}
