"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "@untitledui/icons";
import { THEME_FONTS } from "@convex/lib/themeSpec";
import { THEME_FONT_SOURCES, ensureFontStylesheet, fontStack } from "@/lib/theme-fonts";
import { cn } from "@/lib/utils";

/** Radix Select reserves "" for "no value", so the Pulse default needs a key. */
const DEFAULT_KEY = "__pulse_default";
const SAMPLE = "Studio A, 7:30 PM";

const KIND_LABEL = { sans: "Sans", serif: "Serif", mono: "Mono" } as const;

/**
 * A font select where every option is drawn in its own typeface: the name,
 * then a short sample. Built on the same Radix Select as the app's other
 * selects, so it is a real combobox + listbox (arrow keys, Home/End, type to
 * jump, Escape) and becomes a full-width sheet-like list on a phone.
 *
 * Fonts load lazily: the chosen one at once (the trigger shows it), the rest
 * only as their options scroll into view in the open list.
 */
export function FontPicker({
  id,
  value,
  onChange,
  disabled,
  "aria-describedby": describedBy,
}: {
  id?: string;
  /** "" means the Pulse default. */
  value: string;
  onChange: (font: string) => void;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  React.useEffect(() => {
    ensureFontStylesheet(document, value);
  }, [value]);

  return (
    <SelectPrimitive.Root
      value={value || DEFAULT_KEY}
      onValueChange={(v) => onChange(v === DEFAULT_KEY ? "" : v)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-describedby={describedBy}
        className={cn(
          "pl-field mt-1 flex h-12 w-full items-center justify-between gap-2 rounded-md border border-graphite/60",
          "bg-coal/40 px-3 text-left text-bone outline-none transition-colors",
          "focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/20 disabled:opacity-60",
        )}
      >
        <SelectPrimitive.Value aria-label={value || "Pulse default"}>
          <span className="flex min-w-0 flex-col leading-tight">
            <span
              className="truncate text-[0.95rem]"
              style={value ? { fontFamily: fontStack(value) } : undefined}
            >
              {value || "Pulse default"}
            </span>
            <span
              className="truncate text-[0.6875rem] text-steel"
              style={value ? { fontFamily: fontStack(value) } : undefined}
            >
              {SAMPLE}
            </span>
          </span>
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-steel/70" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          // Solid under the glass: sample text must never sit on page text.
          style={{ backgroundColor: "var(--color-ink)" }}
          className={cn(
            "relative z-50 overflow-hidden rounded-md glass-strong shadow-elev-3",
            "w-[var(--radix-select-trigger-width)] min-w-[15rem] max-w-[calc(100vw-24px)]",
            "max-h-[min(24rem,var(--radix-select-content-available-height))]",
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            <FontOption value={DEFAULT_KEY} name="Pulse default" kind="Default" />
            {THEME_FONTS.map((f) => (
              <FontOption key={f} value={f} name={f} font={f} kind={KIND_LABEL[THEME_FONT_SOURCES[f].kind]} />
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function FontOption({ value, name, font, kind }: { value: string; name: string; font?: string; kind: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);

  // Fetch this font's stylesheet only once the option is (nearly) on screen.
  React.useEffect(() => {
    if (!font) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      ensureFontStylesheet(document, font);
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          ensureFontStylesheet(document, font);
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [font]);

  const family = font && visible ? { fontFamily: fontStack(font) } : undefined;

  return (
    <SelectPrimitive.Item
      ref={ref}
      value={value}
      textValue={name}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-3 rounded-sm py-2 pl-8 pr-3 text-bone outline-none",
        "data-[highlighted]:bg-coal-3 data-[state=checked]:bg-coal-2",
      )}
    >
      <span className="absolute left-2.5 grid place-items-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5 text-gold" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <SelectPrimitive.ItemText>
          <span className="block truncate text-base" style={family}>
            {name}
          </span>
        </SelectPrimitive.ItemText>
        <span className="mt-0.5 block truncate text-[0.75rem] text-steel" style={family} aria-hidden>
          {SAMPLE}
        </span>
      </span>
      <span className="shrink-0 font-meta text-[0.625rem] uppercase tracking-[0.08em] text-steel/70" aria-hidden>
        {kind}
      </span>
    </SelectPrimitive.Item>
  );
}
