"use client";

import * as React from "react";
import { Check } from "@untitledui/icons";
import { BRAND_PRESETS, CUSTOM_PRESET_ID, presetById } from "@convex/lib/brandPresets";
import { AA_TEXT, deriveBrandTheme, previewBrandTokens } from "@/lib/brand-theme";
import { isHex6, normHex, renderedColors } from "@/lib/brand-draft";
import { useBrandingDraft } from "@/components/settings/branding-draft";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { Org } from "@/components/settings/types";
import { UiStylePicker } from "@/components/settings/ui-style-picker";

/**
 * Brand colors for every plan: a preset or a custom primary + secondary.
 * The primary drives buttons, highlights, focus rings, chart accents and the
 * main glow of the moving background; the secondary tints its second glow.
 * On Max it also sets the white-label theme's primary, accent and email
 * accent (lib/themePrecedence.ts).
 *
 * Edits go to the Branding draft; the page's Apply bar saves them through
 * branding.setBrandColors, which validates every hex.
 */
export function BrandColorsCard({ org }: { org: Org }) {
  void org;
  const { draft, saved, setColors } = useBrandingDraft();
  const { preset, primary, secondary } = draft.colors;

  const isCustom = preset === CUSTOM_PRESET_ID;
  const primaryValid = isHex6(primary);
  const secondaryValid = isHex6(secondary);
  const live = renderedColors(draft.colors, saved.colors);
  const theme = deriveBrandTheme(live.primary, live.secondary);

  function pickPreset(id: string) {
    const p = presetById(id);
    // Seed the custom pickers from the last preset, a sensible start.
    setColors(p ? { preset: id, primary: p.primary, secondary: p.secondary } : { preset: id, primary, secondary });
  }

  const accentRatio = theme?.contrast.accentOnSurface;
  const onAccentRatio = theme?.contrast.onAccent;

  return (
    <Card id="brand-colors" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Brand colors</CardTitle>
        <CardDescription>
          On every plan. Your colors carry through buttons, highlights, focus rings, charts and the
          moving background, in the app, on the booking page and on the kiosk. Pick the look below too.
          Nothing changes until you Apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Presets */}
        <div
          role="radiogroup"
          aria-label="Color preset"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 xl:grid-cols-4"
        >
          {[...BRAND_PRESETS, { id: CUSTOM_PRESET_ID, label: "Custom", primary: "", secondary: "" }].map((p) => {
            const active = preset === p.id;
            const custom = p.id === CUSTOM_PRESET_ID;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickPreset(p.id)}
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                  active ? "border-gold bg-coal-2" : "border-graphite/60 hover:border-hairline-2",
                )}
              >
                <span
                  aria-hidden
                  className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-[5px] border border-graphite/60"
                  style={{
                    background: custom
                      ? "conic-gradient(from 180deg, #e8442e, #e8a02d, #e3d24b, #4db56b, #3fa8c9, #4a5fd0, #9b4dd4, #d44a9b, #e8442e)"
                      : `linear-gradient(135deg, ${p.primary} 0 58%, ${p.secondary} 58% 100%)`,
                  }}
                >
                  {active && <Check className="size-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]" />}
                </span>
                <span className="truncate text-xs font-medium text-bone">{p.label}</span>
              </button>
            );
          })}
        </div>

        {/* Custom pickers */}
        {isCustom && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label="Primary"
              hint="Buttons, highlights, focus rings, charts and the main glow."
              value={primary}
              onChange={(v) => setColors({ preset, primary: v, secondary })}
              valid={primaryValid}
            />
            <ColorField
              label="Secondary"
              hint="The second glow and the warm tiles in the background."
              value={secondary}
              onChange={(v) => setColors({ preset, primary, secondary: v })}
              valid={secondaryValid}
            />
          </div>
        )}

        {/* Surface style, part of the same draft */}
        <UiStylePicker tokens={previewBrandTokens(live.primary, live.secondary)} />

        <p className="text-[0.6875rem] text-steel">
          {accentRatio && onAccentRatio ? (
            <>
              Text in your color on dark screens reads at {accentRatio.toFixed(1)}:1, and text on your
              buttons at {onAccentRatio.toFixed(1)}:1 (AA needs {AA_TEXT}:1).
              {isCustom && theme?.adjusted && " We lightened your color a little so text stays readable."}
            </>
          ) : (
            <>Pulse Gold, the stock look.</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
  valid,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-bone">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span
          className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-graphite/60"
          style={{ backgroundColor: valid ? normHex(value) : "transparent" }}
        >
          <input
            type="color"
            value={valid ? normHex(value) : "#fdb913"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            aria-label={`${label} color picker`}
          />
        </span>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#3F6FE8"
          className={cn("max-w-36 font-meta", !valid && value.trim() !== "" && "border-critical/50")}
        />
      </div>
      <p className={cn("text-[0.6875rem]", valid ? "text-steel" : "text-critical")}>
        {valid ? hint : "Enter a 6-digit hex, like #3F6FE8."}
      </p>
    </div>
  );
}
