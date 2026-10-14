"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, Brush01 } from "@untitledui/icons";
import {
  BRAND_PRESETS,
  CUSTOM_PRESET_ID,
  DEFAULT_PRESET_ID,
  STOCK_PRIMARY,
  STOCK_SECONDARY,
  presetById,
} from "@convex/lib/brandPresets";
import {
  AA_TEXT,
  deriveBrandTheme,
  previewBrandTokens,
} from "@/lib/brand-theme";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import type { Org } from "@/components/settings/types";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const norm = (hex: string) => (hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`).toLowerCase();

type Selection = { preset: string; primary: string; secondary: string };

/** What the studio has saved, read back as a preset or custom pair. */
function savedSelection(org: Org): Selection {
  const accent = norm(org.accentColor || STOCK_PRIMARY);
  const preset = presetById(org.brandPreset);
  if (preset && preset.primary === accent) {
    return { preset: preset.id, primary: preset.primary, secondary: preset.secondary };
  }
  const secondary = org.brandSecondary ? norm(org.brandSecondary) : null;
  if (accent === STOCK_PRIMARY && (!secondary || secondary === STOCK_SECONDARY)) {
    return { preset: DEFAULT_PRESET_ID, primary: STOCK_PRIMARY, secondary: STOCK_SECONDARY };
  }
  return {
    preset: CUSTOM_PRESET_ID,
    primary: accent,
    secondary: secondary ?? deriveBrandTheme(accent)?.secondary ?? STOCK_SECONDARY,
  };
}

/**
 * Brand colors for every plan: a preset or a custom primary + secondary.
 * The primary drives buttons, highlights, focus rings, chart accents and the
 * main glow of the moving background; the secondary tints its second glow.
 * Saves through branding.setBrandColors, which validates every hex.
 */
export function BrandColorsCard({ org }: { org: Org }) {
  const setBrandColors = useMutation(api.branding.setBrandColors);
  const saved = savedSelection(org);
  const savedSig = `${saved.preset}|${saved.primary}|${saved.secondary}`;

  const [preset, setPreset] = React.useState(saved.preset);
  const [primary, setPrimary] = React.useState(saved.primary);
  const [secondary, setSecondary] = React.useState(saved.secondary);
  const [saving, setSaving] = React.useState(false);

  // Re-seed when the saved brand changes underneath (another tab, logo match).
  const [prevSig, setPrevSig] = React.useState(savedSig);
  if (prevSig !== savedSig) {
    setPrevSig(savedSig);
    setPreset(saved.preset);
    setPrimary(saved.primary);
    setSecondary(saved.secondary);
  }

  const isCustom = preset === CUSTOM_PRESET_ID;
  const chosen = presetById(preset);
  const primaryValid = HEX_RE.test(primary.trim());
  const secondaryValid = HEX_RE.test(secondary.trim());
  const live: Selection = chosen
    ? { preset, primary: chosen.primary, secondary: chosen.secondary }
    : {
        preset,
        primary: primaryValid ? norm(primary) : saved.primary,
        secondary: secondaryValid ? norm(secondary) : saved.secondary,
      };

  const theme = deriveBrandTheme(live.primary, live.secondary);
  const tokens = previewBrandTokens(live.primary, live.secondary);
  const dirty =
    live.preset !== saved.preset || live.primary !== saved.primary || live.secondary !== saved.secondary;
  const valid = !isCustom || (primaryValid && secondaryValid);

  function pickPreset(id: string) {
    setPreset(id);
    const p = presetById(id);
    if (p) {
      // Seed the custom pickers from the last preset, a sensible start.
      setPrimary(p.primary);
      setSecondary(p.secondary);
    }
  }

  async function save() {
    if (!valid) {
      toast.error("Colors must be 6-digit hex values.");
      return;
    }
    setSaving(true);
    try {
      await setBrandColors(
        isCustom
          ? { preset: CUSTOM_PRESET_ID, primary: live.primary, secondary: live.secondary }
          : { preset: live.preset },
      );
      toast.success("Brand colors saved. The app, booking page and kiosk now wear them.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not save brand colors.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setPreset(saved.preset);
    setPrimary(saved.primary);
    setSecondary(saved.secondary);
  }

  const accentRatio = theme?.contrast.accentOnSurface;
  const onAccentRatio = theme?.contrast.onAccent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand colors</CardTitle>
        <CardDescription>
          On every plan. Your colors carry through buttons, highlights, focus rings, charts and the
          moving background, in the app, on the booking page and on the kiosk.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Presets */}
        <div
          role="radiogroup"
          aria-label="Color preset"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
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
              onChange={setPrimary}
              valid={primaryValid}
            />
            <ColorField
              label="Secondary"
              hint="The second glow and the warm tiles in the background."
              value={secondary}
              onChange={setSecondary}
              valid={secondaryValid}
            />
          </div>
        )}

        {/* Live preview */}
        <div className="space-y-2">
          <p className="overline">Preview</p>
          <BrandPreviewTile tokens={tokens} />
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
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" variant="ghost" onClick={reset} disabled={saving || !dirty}>
          Reset
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !dirty || !valid}>
          <Brush01 className="size-4" />
          {saving ? "Saving…" : "Save colors"}
        </Button>
      </CardFooter>
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
          style={{ backgroundColor: valid ? norm(value) : "transparent" }}
        >
          <input
            type="color"
            value={valid ? norm(value) : "#fdb913"}
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

/**
 * A still, pocket-sized room light with a chassis on it: the background
 * glows and lit tiles, the active nav key, a primary key, a status chip,
 * an LED with its bar, a focus ring and a chart line, all in the chosen
 * colors. Static on purpose, so it needs no reduced-motion handling.
 */
function BrandPreviewTile({ tokens }: { tokens: Record<string, string> }) {
  return (
    <div
      aria-hidden
      className="relative isolate h-56 overflow-hidden rounded-lg border border-graphite/60"
      style={{ ...(tokens as React.CSSProperties), background: "var(--pl-void, #0f0f11)" }}
    >
      {/* Room light: tiles under three pools, then a lighter dimmer than the
          app's so the colors read at this size. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "var(--pl-yellow)",
          WebkitMaskImage: "url(/hw/tiles-lit.svg?v=1)",
          maskImage: "url(/hw/tiles-lit.svg?v=1)",
          WebkitMaskSize: "224px 224px",
          maskSize: "224px 224px",
          opacity: 0.9,
        }}
      />
      <div
        className="absolute -left-16 -top-24 size-72 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(var(--pl-yellow-rgb), 0.27), rgba(var(--pl-yellow-rgb), 0.1) 40%, transparent)" }}
      />
      <div
        className="absolute -bottom-28 -right-16 size-72 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(var(--pl-copper-rgb), 0.25), rgba(var(--pl-copper-rgb), 0.09) 40%, transparent)" }}
      />
      <div
        className="absolute left-1/3 top-1/4 size-48 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(var(--pl-amber-rgb), 0.16), transparent)" }}
      />
      <div className="absolute inset-0" style={{ background: "var(--pl-void, #0f0f11)", opacity: 0.45 }} />

      {/* A chassis on the void, leaving a gutter where the room light shows */}
      <div className="absolute inset-0 flex justify-end p-5 sm:pl-24">
      <div className="pl-card flex h-full w-full max-w-[620px] gap-4 p-4">
        <div className="hidden w-40 shrink-0 flex-col gap-1.5 sm:flex">
          <span className="pl-bar w-14" />
          <span className="pl-nav-item mt-2" data-active="true">
            <span className="pl-led" data-on="true" />
            Dashboard
          </span>
          <span className="pl-nav-item">
            <span className="pl-led" />
            Bookings
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pl-chip" data-tone="gold">
              DEPOSIT
            </span>
            <span className="pl-chip" data-tone="solid">
              LIVE NOW
            </span>
            <span
              className="rounded-[4px] px-2 py-1 text-[11px] text-bone"
              style={{ outline: "2px solid var(--pl-yellow)", outlineOffset: 2 }}
            >
              Focus
            </span>
          </div>
          <svg viewBox="0 0 200 48" className="h-12 w-full" preserveAspectRatio="none">
            <polyline
              points="0,40 25,34 50,36 75,22 100,26 125,14 150,18 175,8 200,12"
              fill="none"
              stroke="var(--pl-yellow)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="mt-auto flex items-center gap-2">
            <span className="pl-key inline-flex items-center" data-variant="primary" data-size="sm">
              New booking
            </span>
            <span className="pl-key inline-flex items-center" data-variant="secondary" data-size="sm">
              Later
            </span>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
