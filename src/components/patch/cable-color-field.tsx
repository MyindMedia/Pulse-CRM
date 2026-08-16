"use client";

import * as React from "react";
import { Check, Palette, Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CABLE_COLORS, cableColorHex } from "./constants";

/* ============================================================
   Jacket colour.

   The eight presets cover most lockers. Studios that colour-code
   by channel, by client, or by "the blue-ish ones we bought in
   2019" need the rest of the spectrum, so the matrix is there
   for anything the presets do not carry.

   Stored value is either a preset name or a raw hex string, and
   `cableColorHex` already resolves both.
   ============================================================ */

/** Hue columns for the matrix, spread evenly round the wheel. */
const HUES = [0, 20, 40, 60, 100, 150, 180, 200, 220, 260, 290, 320];
/** Lightness rows, dark to light. Saturation eases off at the extremes
    so the top and bottom rows do not read as flat black and flat white. */
const ROWS: { l: number; s: number }[] = [
  { l: 22, s: 60 },
  { l: 34, s: 72 },
  { l: 46, s: 80 },
  { l: 58, s: 82 },
  { l: 70, s: 78 },
  { l: 82, s: 66 },
];

const NEUTRALS = ["#0f0f11", "#2b2b32", "#4a4a52", "#6c6c76", "#a3a3ad", "#d7d7dc", "#f6f6f5"];

/** hsl to hex, so everything downstream only ever deals in hex. */
function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) =>
    Math.round(255 * (lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const PRESET_VALUES = new Set(CABLE_COLORS.map((c) => c.value));

export function CableColorField({
  value,
  onChange,
  size = "md",
  disabled,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(cableColorHex(value) ?? "#fdb913");

  const isCustom = !!value && !PRESET_VALUES.has(value.toLowerCase());
  const currentHex = cableColorHex(value);
  const swatch = size === "sm" ? "size-6" : "size-7";

  function commit(hex: string) {
    onChange(hex);
    setDraft(hex);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CABLE_COLORS.map((color) => (
        <Tooltip key={color.value} label={color.label}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(color.value)}
            aria-label={`${color.label} jacket`}
            aria-pressed={value === color.value}
            className={cn(
              swatch,
              "rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40",
              value === color.value ? "border-gold ring-2 ring-gold/30" : "border-hairline-2",
            )}
            style={{ background: color.hex }}
          />
        </Tooltip>
      ))}

      <span className="mx-0.5 h-5 w-px bg-hairline-2" />

      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip
          label={isCustom ? "Custom colour" : "Pick any colour"}
          hint="For a jacket the presets do not carry."
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Choose a custom jacket colour"
              className={cn(
                swatch,
                "grid place-items-center rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40",
                isCustom ? "border-gold ring-2 ring-gold/30" : "border-dashed border-graphite/70",
              )}
              style={isCustom && currentHex ? { background: currentHex } : undefined}
            >
              {!isCustom && <Palette className="size-3 text-steel" />}
            </button>
          </PopoverTrigger>
        </Tooltip>

        <PopoverContent align="start" className="w-auto p-3">
          <p className="overline mb-2">Custom jacket</p>

          {/* The matrix. Hue across, light to dark down. */}
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${HUES.length}, minmax(0, 1fr))` }}
            role="group"
            aria-label="Colour matrix"
          >
            {ROWS.map((row) =>
              HUES.map((hue) => {
                const hex = hslHex(hue, row.s, row.l);
                const active = currentHex?.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={`${hue}-${row.l}`}
                    type="button"
                    onClick={() => commit(hex)}
                    aria-label={hex}
                    className={cn(
                      "size-5 rounded-[4px] transition-transform hover:scale-125 hover:ring-1 hover:ring-bone/40",
                      active && "ring-2 ring-gold",
                    )}
                    style={{ background: hex }}
                  />
                );
              }),
            )}
          </div>

          {/* Neutrals get their own row: most studios have a black, a grey
              and a white, and mixing them into the hue grid loses them. */}
          <div className="mt-[3px] flex gap-[3px]">
            {NEUTRALS.map((hex) => {
              const active = currentHex?.toLowerCase() === hex.toLowerCase();
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => commit(hex)}
                  aria-label={hex}
                  className={cn(
                    "size-5 rounded-[4px] border border-hairline-2 transition-transform hover:scale-125",
                    active && "ring-2 ring-gold",
                  )}
                  style={{ background: hex }}
                />
              );
            })}
          </div>

          {/* Exact value, for a studio that colour-codes to a brand hex. */}
          <div className="mt-3 flex items-center gap-2">
            <Tooltip label="Eyedropper and system picker">
              <label
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-graphite/60 transition-colors hover:border-gold-dim"
                style={{ background: draft }}
              >
                <Pipette className="size-3.5 mix-blend-difference text-bone" />
                <input
                  type="color"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commit(draft)}
                  className="sr-only"
                  aria-label="System colour picker"
                />
              </label>
            </Tooltip>

            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(draft.trim())) commit(draft.trim());
                }
              }}
              placeholder="#fdb913"
              aria-label="Hex colour"
              className="h-8 font-meta text-xs"
            />

            <button
              type="button"
              onClick={() => {
                if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(draft.trim())) {
                  commit(draft.trim());
                  setOpen(false);
                }
              }}
              aria-label="Use this colour"
              className="grid size-8 shrink-0 place-items-center rounded-md border border-gold-dim/60 bg-gold/15 text-gold-bright transition-colors hover:bg-gold/25"
            >
              <Check className="size-4" />
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
