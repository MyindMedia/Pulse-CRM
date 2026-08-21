"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Lock, Palette, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  THEME_FONTS,
  THEME_RADII,
  THEME_DENSITIES,
  THEME_COLOR_VARS,
  PULSE_DEFAULT_COLORS,
  contrastRatio,
  MIN_TEXT_CONTRAST,
  type ThemeColorKey,
} from "@convex/lib/themeSpec";
import { PLAN_LIMITS, priceLabel } from "@convex/lib/plans";
import { PoweredByPulse } from "@/components/brand/powered-by-pulse";

/* The Label tier's headline feature: put the studio's own brand on the whole
   app. Everything here writes through convex/theme.ts, which re-validates and
   re-checks the entitlement, so this panel is a convenience, not the guard. */

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
  const canTheme = useQuery(api.theme.canTheme);
  const save = useMutation(api.theme.save);
  const reset = useMutation(api.theme.reset);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const genUploadUrl = useMutation(api.theme.generateUploadUrl);
  const setLoginBackground = useMutation(api.theme.setLoginBackground);

  async function uploadBackground(file: File) {
    setUploading(true);
    try {
      const url = await genUploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: string };
      await setLoginBackground({ storageId: storageId as Id<"_storage"> });
      toast.success("Sign-in background updated.");
    } catch {
      toast.error("Could not upload that image.");
    } finally {
      setUploading(false);
    }
  }
  const [draft, setDraft] = React.useState<Record<string, string>>({});

  // Seed the draft once the server answers, then leave it under the user's
  // control so a re-render mid-edit never stomps a half-typed value.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !theme) return;
    seeded.current = true;
    setDraft({
      appName: theme.appName ?? "",
      ...Object.fromEntries(COLOR_FIELDS.map((f) => [f.key, theme.colors[f.key]])),
      fontHeading: theme.fontHeading ?? "",
      fontBody: theme.fontBody ?? "",
      radius: theme.radius,
      density: theme.density,
      loginHeadline: theme.loginHeadline ?? "",
      loginSubhead: theme.loginSubhead ?? "",
      emailHeaderColor: theme.emailHeaderColor ?? "",
      emailFooterText: theme.emailFooterText ?? "",
    });
  }, [theme]);

  const bg = draft.background ?? PULSE_DEFAULT_COLORS.background;
  const fg = draft.text ?? PULSE_DEFAULT_COLORS.text;
  const ratio = React.useMemo(() => {
    try {
      return contrastRatio(bg, fg);
    } catch {
      return 0;
    }
  }, [bg, fg]);
  const readable = ratio >= MIN_TEXT_CONTRAST;

  if (canTheme === false) {
    const need = "label" as const;
    return (
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-coal/60 text-steel">
              <Lock className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-grotesk text-sm font-semibold text-bone">White-label the app</p>
                <Badge tone="gold">{PLAN_LIMITS[need].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-steel">
                Put your logo, colors, fonts and sign-in screen on the whole app, on your own
                domain. Your team and your clients see your brand. A small Powered by Pulse line
                sits under your logo.
              </p>
              <Button asChild className="mt-3" size="sm">
                <a href="/settings">
                  Upgrade to {PLAN_LIMITS[need].label} · {priceLabel(need)}/mo
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function onSave() {
    setBusy(true);
    try {
      await save({
        appName: draft.appName || undefined,
        primary: draft.primary,
        accent: draft.accent,
        background: draft.background,
        surface: draft.surface,
        text: draft.text,
        muted: draft.muted,
        border: draft.border,
        fontHeading: draft.fontHeading || undefined,
        fontBody: draft.fontBody || undefined,
        radius: draft.radius as "sharp" | "soft" | "round" | undefined,
        density: draft.density as "compact" | "comfortable" | undefined,
        loginHeadline: draft.loginHeadline || undefined,
        loginSubhead: draft.loginSubhead || undefined,
        emailHeaderColor: draft.emailHeaderColor || undefined,
        emailFooterText: draft.emailFooterText || undefined,
      });
      toast.success("Your brand is live across the app.");
    } catch (e) {
      const data = (e as { data?: { code?: string; message?: string } })?.data;
      toast.error(data?.message ?? "Could not save that theme.");
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    try {
      await reset({});
      seeded.current = false;
      toast.success("Back to Pulse colors.");
    } catch {
      toast.error("Could not reset the theme.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <Palette className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-grotesk text-sm font-semibold text-bone">White-label the app</p>
              <Badge tone="gold">Label</Badge>
            </div>
            <p className="text-xs text-steel">
              Your logo, colors and type across the whole app. Changes apply live.
            </p>
          </div>
        </div>

        <label className="block">
          <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
            App name
          </span>
          <input
            value={draft.appName ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, appName: e.target.value }))}
            placeholder="Your studio name"
            className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
          />
        </label>

        <div>
          <p className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">Palette</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COLOR_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-[0.7rem] text-bone">{f.label}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  <input
                    type="color"
                    value={draft[f.key] ?? PULSE_DEFAULT_COLORS[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="size-8 shrink-0 cursor-pointer rounded border border-graphite/60 bg-transparent"
                    aria-label={f.label}
                  />
                  <input
                    value={draft[f.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="w-full min-w-0 rounded-md border border-graphite/60 bg-coal/40 px-2 py-1 font-mono text-[0.7rem] text-bone outline-none focus:border-gold"
                  />
                </span>
                <span className="mt-0.5 block text-[0.625rem] text-steel/70">{f.hint}</span>
              </label>
            ))}
          </div>
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
            <label key={k} className="block">
              <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
                {k === "fontHeading" ? "Headings" : "Body"}
              </span>
              <select
                value={draft[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
              >
                <option value="">Pulse default</option>
                {THEME_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Corners
            </span>
            <select
              value={draft.radius ?? "soft"}
              onChange={(e) => setDraft((d) => ({ ...d, radius: e.target.value }))}
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            >
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
            <select
              value={draft.density ?? "comfortable"}
              onChange={(e) => setDraft((d) => ({ ...d, density: e.target.value }))}
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            >
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
              value={draft.loginHeadline ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, loginHeadline: e.target.value }))}
              placeholder="Welcome back"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Sign-in subhead
            </span>
            <input
              value={draft.loginSubhead ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, loginSubhead: e.target.value }))}
              placeholder="Everything your studio runs on, in one place."
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Email accent
            </span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={draft.emailHeaderColor || draft.primary || PULSE_DEFAULT_COLORS.primary}
                onChange={(e) => setDraft((d) => ({ ...d, emailHeaderColor: e.target.value }))}
                className="size-8 shrink-0 cursor-pointer rounded border border-graphite/60 bg-transparent"
                aria-label="Email accent colour"
              />
              <input
                value={draft.emailHeaderColor ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, emailHeaderColor: e.target.value }))}
                placeholder="Matches your primary"
                className="w-full min-w-0 rounded-md border border-graphite/60 bg-coal/40 px-2 py-1.5 font-mono text-[0.7rem] text-bone outline-none focus:border-gold"
              />
            </span>
            <span className="mt-0.5 block text-[0.625rem] text-steel/70">
              The rule and button colour on client emails.
            </span>
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Email footer line
            </span>
            <input
              value={draft.emailFooterText ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, emailFooterText: e.target.value }))}
              placeholder="Vault Studios, 12 Bell Street, Atlanta"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
            <span className="mt-0.5 block text-[0.625rem] text-steel/70">
              Sits above the Pulse line, which stays.
            </span>
          </label>
        </div>

        <div>
          <p className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
            Sign-in background
          </p>
          <p className="mt-0.5 text-[0.625rem] text-steel/70">
            Shown behind your sign-in form, under a scrim so the form stays readable
            whatever you upload.
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

        {/* Not a preview toggle. This is what every white-labeled workspace
            renders under its logo, and it is not removable at any price. */}
        <div className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <p className="text-[0.7rem] text-steel">
            Every white-labeled workspace carries this under your logo:
          </p>
          <PoweredByPulse className="mt-1" href={null} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onSave} disabled={busy || !readable} size="sm">
            {busy ? "Saving…" : "Save brand"}
          </Button>
          <Button onClick={onReset} disabled={busy} size="sm" variant="ghost">
            <RotateCcw className="mr-1.5 size-3.5" />
            Reset to Pulse
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
