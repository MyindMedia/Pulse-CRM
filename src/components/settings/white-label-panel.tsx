"use client";

import * as React from "react";
import { useR2Upload, r2NotConfigured } from "@/lib/use-r2-upload";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Lock, Palette, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  THEME_RADII,
  THEME_DENSITIES,
  PULSE_DEFAULT_COLORS,
  MIN_TEXT_CONTRAST,
  type ThemeColorKey,
} from "@convex/lib/themeSpec";
import { renderedColors, textContrast, type ThemeDraftKey } from "@/lib/brand-draft";
import { useBrandingDraft } from "@/components/settings/branding-draft";
import { FontPicker } from "@/components/settings/font-picker";
import { PLAN_LIMITS, priceLabel } from "@convex/lib/plans";
import { PoweredByPulse } from "@/components/brand/powered-by-pulse";

/* The Max tier's headline feature: put the studio's own brand on the whole
   app. Edits go to the Branding draft (branding-draft.tsx) and reach
   convex/theme.ts on Apply, which re-validates and re-checks the
   entitlement, so this panel is a convenience, not the guard. */

const COLOR_FIELDS: { key: ThemeColorKey; label: string; hint: string }[] = [
  { key: "primary", label: "Primary", hint: "Buttons, active states" },
  { key: "accent", label: "Accent", hint: "Highlights and badges" },
  { key: "background", label: "Background", hint: "The app canvas" },
  { key: "surface", label: "Surface", hint: "Cards and panels" },
  { key: "text", label: "Text", hint: "Body copy" },
  { key: "muted", label: "Muted", hint: "Secondary copy" },
  { key: "border", label: "Border", hint: "Dividers and outlines" },
];

export function WhiteLabelPanel() {
  const theme = useQuery(api.theme.get);
  const { draft, saved, canTheme, brandDriven, setThemeValue, clearThemeEdits, applying } = useBrandingDraft();
  const reset = useMutation(api.theme.reset);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const genUploadUrl = useMutation(api.theme.generateUploadUrl);
  const setLoginBackground = useMutation(api.theme.setLoginBackground);
  const uploadToR2 = useR2Upload();

  async function uploadBackground(file: File) {
    setUploading(true);
    try {
      let storageId: Id<"_storage"> | Id<"mediaFiles">;
      try {
        storageId = await uploadToR2(file, "photo");
      } catch (err) {
        if (!r2NotConfigured(err)) throw err;
        const url = await genUploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        storageId = ((await res.json()) as { storageId: string }).storageId as Id<"_storage">;
      }
      await setLoginBackground({ storageId });
      toast.success("Sign-in background updated.");
    } catch {
      toast.error("Could not upload that image.");
    } finally {
      setUploading(false);
    }
  }

  const t = draft.theme;
  const set = (k: ThemeDraftKey) => (v: string) => setThemeValue(k, v);
  const locked = canTheme === false;
  // Previewable controls stay usable on a locked plan (the preview shows
  // them with a Max label; Apply leaves them out). The rest are read-only.
  const lockText = locked;
  const brandPrimary = renderedColors(draft.colors, saved.colors).primary;

  const ratio = React.useMemo(() => textContrast(t), [t]);
  const readable = ratio >= MIN_TEXT_CONTRAST;

  async function onReset() {
    if (!window.confirm("Reset the white-label theme to Pulse? This saves right away and clears your app name, sign-in and email settings too.")) return;
    setBusy(true);
    try {
      await reset({});
      clearThemeEdits();
      toast.success("Back to Pulse colors.");
    } catch {
      toast.error("Could not reset the theme.");
    } finally {
      setBusy(false);
    }
  }

  const need = "max" as const;
  const fieldCls =
    "mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold disabled:opacity-60";

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${locked ? "bg-coal/60 text-steel" : "bg-gold/12 text-gold"}`}
          >
            {locked ? <Lock className="size-4" /> : <Palette className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-grotesk text-sm font-semibold text-bone">White-label the app</p>
              <Badge tone="gold">{locked ? PLAN_LIMITS[need].label : "Label"}</Badge>
            </div>
            {locked ? (
              <>
                <p className="mt-1 text-xs text-steel">
                  Put your logo, colors, fonts and sign-in screen on the whole app, on your own
                  domain. Your team and your clients see your brand. A small Powered by Pulse line
                  sits under your logo. Try the palette, fonts and corners below in the preview;
                  they apply on {PLAN_LIMITS[need].label}.
                </p>
                <Button asChild className="mt-3" size="sm">
                  <a href="/settings?tab=billing">
                    Upgrade to {PLAN_LIMITS[need].label} · {priceLabel(need)}/mo
                  </a>
                </Button>
              </>
            ) : (
              <p className="text-xs text-steel">
                Your logo, colors and type across the whole app. Preview your changes, then Apply.
              </p>
            )}
          </div>
        </div>

        <label className="block">
          <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
            App name
          </span>
          <input
            value={t.appName}
            onChange={(e) => set("appName")(e.target.value)}
            placeholder="Your studio name"
            disabled={lockText}
            className={fieldCls}
          />
        </label>

        <div>
          <p className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">Palette</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COLOR_FIELDS.map((f) => {
              const byBrand = brandDriven && (f.key === "primary" || f.key === "accent");
              if (byBrand) return <BrandDrivenSwatch key={f.key} label={f.label} color={brandPrimary} />;
              return (
                <label key={f.key} className="block">
                  <span className="text-[0.7rem] text-bone">{f.label}</span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(t[f.key]) ? t[f.key] : PULSE_DEFAULT_COLORS[f.key]}
                      onChange={(e) => set(f.key)(e.target.value)}
                      className="size-8 shrink-0 cursor-pointer rounded border border-graphite/60 bg-transparent"
                      aria-label={f.label}
                    />
                    <input
                      value={t[f.key]}
                      onChange={(e) => set(f.key)(e.target.value)}
                      aria-label={`${f.label} hex`}
                      className="w-full min-w-0 rounded-md border border-graphite/60 bg-coal/40 px-2 py-1 font-mono text-[0.7rem] text-bone outline-none focus:border-gold"
                    />
                  </span>
                  <span className="mt-0.5 block text-[0.625rem] text-steel/70">{f.hint}</span>
                </label>
              );
            })}
          </div>
          {brandDriven && (
            <p className="mt-2 text-[0.7rem] text-steel/80">
              Primary, Accent and the email accent follow your{" "}
              <a href="#brand-colors" className="text-gold underline-offset-2 hover:underline">
                Brand colors
              </a>
              . Background, surfaces, text, fonts and corners stay yours.
            </p>
          )}
          {/* The same check the server runs. Shown here so the studio sees the
              problem while picking, not after a rejected save. */}
          <p
            className={`mt-2 text-[0.7rem] ${readable ? "text-steel/70" : "text-red-400"}`}
            role={readable ? undefined : "alert"}
          >
            Text on background: {ratio.toFixed(1)}:1
            {readable
              ? " · readable"
              : ` · needs ${MIN_TEXT_CONTRAST}:1. Lighten the text or darken the background.`}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["fontHeading", "fontBody"] as const).map((k) => (
            <div key={k}>
              <label htmlFor={`wl-${k}`} className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
                {k === "fontHeading" ? "Headings" : "Body"}
              </label>
              <FontPicker id={`wl-${k}`} value={t[k]} onChange={set(k)} disabled={applying} />
            </div>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Corners
            </span>
            <select value={t.radius} onChange={(e) => set("radius")(e.target.value)} className={fieldCls}>
              {THEME_RADII.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Density
            </span>
            <select value={t.density} onChange={(e) => set("density")(e.target.value)} className={fieldCls}>
              {THEME_DENSITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Sign-in headline
            </span>
            <input
              value={t.loginHeadline}
              onChange={(e) => set("loginHeadline")(e.target.value)}
              placeholder="Welcome back"
              disabled={lockText}
              className={fieldCls}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Sign-in subhead
            </span>
            <input
              value={t.loginSubhead}
              onChange={(e) => set("loginSubhead")(e.target.value)}
              placeholder="Everything your studio runs on, in one place."
              disabled={lockText}
              className={fieldCls}
            />
          </label>
          {brandDriven ? (
            <BrandDrivenSwatch label="Email accent" color={brandPrimary} wide />
          ) : (
            <label className="block">
              <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
                Email accent
              </span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={t.emailHeaderColor || t.primary || PULSE_DEFAULT_COLORS.primary}
                  onChange={(e) => set("emailHeaderColor")(e.target.value)}
                  disabled={lockText}
                  className="size-8 shrink-0 cursor-pointer rounded border border-graphite/60 bg-transparent"
                  aria-label="Email accent color"
                />
                <input
                  value={t.emailHeaderColor}
                  onChange={(e) => set("emailHeaderColor")(e.target.value)}
                  placeholder="Matches your primary"
                  disabled={lockText}
                  aria-label="Email accent hex"
                  className="w-full min-w-0 rounded-md border border-graphite/60 bg-coal/40 px-2 py-1.5 font-mono text-[0.7rem] text-bone outline-none focus:border-gold disabled:opacity-60"
                />
              </span>
              <span className="mt-0.5 block text-[0.625rem] text-steel/70">
                The rule and button color on client emails.
              </span>
            </label>
          )}
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Email footer line
            </span>
            <input
              value={t.emailFooterText}
              onChange={(e) => set("emailFooterText")(e.target.value)}
              placeholder="Vault Studios, 12 Bell Street, Atlanta"
              disabled={lockText}
              className={fieldCls}
            />
            <span className="mt-0.5 block text-[0.625rem] text-steel/70">
              Sits above the Pulse line, which stays.
            </span>
          </label>
        </div>

        {!locked && (
          <div>
            <p className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Sign-in background
            </p>
            <p className="mt-0.5 text-[0.625rem] text-steel/70">
              Shown behind your sign-in form, under a scrim so the form stays readable
              whatever you upload. Uploads save right away.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {theme?.loginBackgroundUrl && (
                <img
                  src={theme.loginBackgroundUrl!}
                  alt=""
                  className="h-14 w-24 rounded-md border border-graphite/60 object-cover"
                />
              )}
              <label className="cursor-pointer rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-xs text-steel transition-colors hover:border-gold hover:text-bone">
                {uploading ? "Uploading…" : theme?.loginBackgroundUrl ? "Replace image" : "Upload image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadBackground(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
        )}

        {/* Not a preview toggle. This is what every white-labeled workspace
            renders under its logo, and it is not removable at any price. */}
        <div className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <p className="text-[0.7rem] text-steel">
            Every white-labeled workspace carries this under your logo:
          </p>
          <PoweredByPulse className="mt-1" href={null} />
        </div>

        {!locked && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-steel">Changes here apply with the bar at the bottom of the page.</p>
            <Button onClick={onReset} disabled={busy || applying} size="sm" variant="ghost" className="ml-auto">
              <RotateCcw className="mr-1.5 size-3.5" />
              Reset to Pulse
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A theme color that Brand colors set: shown, not edited here. */
function BrandDrivenSwatch({ label, color, wide }: { label: string; color: string; wide?: boolean }) {
  return (
    <div className="block">
      <span className={wide ? "font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel" : "text-[0.7rem] text-bone"}>
        {label}
      </span>
      <span className="mt-0.5 flex items-center gap-2">
        <span
          aria-hidden
          className="size-8 shrink-0 rounded border border-graphite/60"
          style={{ backgroundColor: color }}
        />
        <span className="w-full min-w-0 rounded-md border border-dashed border-graphite/60 px-2 py-1 font-mono text-[0.7rem] text-steel">
          {color}
        </span>
      </span>
      <a href="#brand-colors" className="mt-0.5 block text-[0.625rem] text-gold underline-offset-2 hover:underline">
        Set by Brand colors
      </a>
    </div>
  );
}
