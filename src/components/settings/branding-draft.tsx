"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Eye } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { brandColorsSet } from "@convex/lib/themePrecedence";
import type { Org } from "@/components/settings/types";
import {
  PREVIEWABLE_THEME_KEYS,
  applyEdits,
  colorsPayload,
  diffBrandDraft,
  draftProblem,
  savedColors,
  savedTheme,
  themePayload,
  type BrandDraft,
  type BrandEdits,
  type ColorsDraft,
  type DraftDiff,
  type Look,
  type ThemeDraftKey,
} from "@/lib/brand-draft";

/* ============================================================
   One draft for every look-and-feel control on Settings > Branding:
   brand colors, the Look (Hardware or Glass) and the Max white-label
   theme. Controls write here, the preview reads here, and only Apply
   calls the mutations, so the app changes when the studio says so.
   ============================================================ */

type Ctx = {
  org: Org;
  saved: BrandDraft;
  draft: BrandDraft;
  diff: DraftDiff;
  /** Max white-label theme: true when this studio can save it, false when
   *  locked, undefined while loading. */
  canTheme: boolean | undefined;
  /** The theme as the server paints it today (null while loading). */
  themeActive: boolean;
  /** Brand colors drive the theme's primary, accent and email accent (set
   *  already, or being set in this draft). lib/themePrecedence. */
  brandDriven: boolean;
  /** The preview paints the white-label theme. */
  previewTheme: boolean;
  /** Theme keys that differ but this plan cannot apply. */
  lockedThemeKeys: ThemeDraftKey[];
  applying: boolean;
  setColors: (c: ColorsDraft) => void;
  setLook: (l: Look) => void;
  setThemeValue: (k: ThemeDraftKey, v: string) => void;
  /** Drop theme edits only (after a server-side reset). */
  clearThemeEdits: () => void;
  apply: () => Promise<void>;
  discard: () => void;
};

const BrandingDraftContext = React.createContext<Ctx | null>(null);

export function useBrandingDraft(): Ctx {
  const ctx = React.useContext(BrandingDraftContext);
  if (!ctx) throw new Error("useBrandingDraft needs a BrandingDraftProvider");
  return ctx;
}

const GROUP_LABELS: { label: string; keys: ThemeDraftKey[] }[] = [
  { label: "Theme colors", keys: ["primary", "accent", "background", "surface", "text", "muted", "border"] },
  { label: "Fonts", keys: ["fontHeading", "fontBody"] },
  { label: "Corners", keys: ["radius"] },
  { label: "Density", keys: ["density"] },
  { label: "App name", keys: ["appName"] },
  { label: "Sign-in and email", keys: ["loginHeadline", "loginSubhead", "emailHeaderColor", "emailFooterText"] },
];

/** Plain-words list of what changed, for the Unsaved bar. */
export function changeSummary(diff: DraftDiff): string[] {
  const out: string[] = [];
  if (diff.colors) out.push("Brand colors");
  if (diff.look) out.push("Look");
  for (const g of GROUP_LABELS) if (g.keys.some((k) => diff.themeKeys.includes(k))) out.push(g.label);
  return out;
}

const LEAVE_MESSAGE = "You have branding changes that are not applied yet. Leave and lose them?";

export function BrandingDraftProvider({ org, children }: { org: Org; children: React.ReactNode }) {
  const theme = useQuery(api.theme.get);
  const canTheme = useQuery(api.theme.canTheme);
  const setBrandColors = useMutation(api.branding.setBrandColors);
  const setUiStyle = useMutation(api.branding.setUiStyle);
  const saveTheme = useMutation(api.theme.save);

  const [edits, setEdits] = React.useState<BrandEdits>({});
  const [applying, setApplying] = React.useState(false);

  const saved = React.useMemo<BrandDraft>(
    () => ({
      colors: savedColors(org),
      look: org.uiStyle === "glass" ? "glass" : "hardware",
      theme: savedTheme(theme),
    }),
    [org, theme],
  );
  const draft = React.useMemo(() => applyEdits(saved, edits), [saved, edits]);
  const diff = React.useMemo(() => diffBrandDraft(saved, draft), [saved, draft]);
  const lockedThemeKeys = canTheme === true ? [] : diff.themeKeys;
  const brandDriven = brandColorsSet(org) || diff.colors;
  const previewTheme =
    canTheme === true
      ? Boolean(theme?.active)
      : lockedThemeKeys.some((k) => PREVIEWABLE_THEME_KEYS.includes(k));
  // What Apply would actually write. A plan without the theme still sees
  // its theme edits in the preview, but they stay there.
  const applicable = diff.colors || diff.look || (canTheme === true && diff.themeKeys.length > 0);

  const setColors = React.useCallback((c: ColorsDraft) => setEdits((e) => ({ ...e, colors: c })), []);
  const setLook = React.useCallback((l: Look) => setEdits((e) => ({ ...e, look: l })), []);
  const setThemeValue = React.useCallback(
    (k: ThemeDraftKey, v: string) => setEdits((e) => ({ ...e, theme: { ...(e.theme ?? {}), [k]: v } })),
    [],
  );
  const clearThemeEdits = React.useCallback(() => setEdits((e) => ({ ...e, theme: undefined })), []);
  const discard = React.useCallback(() => setEdits({}), []);

  const apply = React.useCallback(async () => {
    const withTheme = canTheme === true;
    const problem = draftProblem(draft, diff, withTheme);
    if (problem) {
      toast.error(problem);
      return;
    }
    setApplying(true);
    try {
      // Theme first: it is the one the server is most likely to refuse
      // (contrast), and nothing else has changed yet if it does.
      if (withTheme && diff.themeKeys.length > 0) {
        await saveTheme(themePayload(draft.theme, diff.themeKeys) as Parameters<typeof saveTheme>[0]);
        setEdits((e) => ({ ...e, theme: undefined }));
      }
      if (diff.colors) {
        await setBrandColors(colorsPayload(draft.colors));
        setEdits((e) => ({ ...e, colors: undefined }));
      }
      if (diff.look) {
        await setUiStyle({ uiStyle: draft.look });
        setEdits((e) => ({ ...e, look: undefined }));
      }
      toast.success(
        withTheme || diff.themeKeys.length === 0
          ? "Branding applied. The app, booking page and kiosk now wear it."
          : "Brand colors and Look applied. Theme changes need the Max plan, so they stay in the preview.",
      );
    } catch (err) {
      const data = (err as { data?: unknown })?.data;
      const message =
        typeof data === "string"
          ? data
          : (data as { message?: string } | undefined)?.message ??
            (err instanceof ConvexError ? String(err.data) : "Could not apply those changes.");
      toast.error(message);
    } finally {
      setApplying(false);
    }
  }, [canTheme, draft, diff, saveTheme, setBrandColors, setUiStyle]);

  // Leaving with unapplied changes: the browser's own prompt for reloads and
  // closed tabs, and a confirm for in-app links (the sidebar, the top bar).
  const dirty = diff.dirty;
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // Capture on window runs before React's listeners on the document, so a
    // cancelled click never reaches next/link.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const value = React.useMemo<Ctx>(
    () => ({
      org,
      saved,
      draft,
      diff,
      canTheme,
      themeActive: Boolean(theme?.active),
      brandDriven,
      previewTheme,
      lockedThemeKeys,
      applying,
      setColors,
      setLook,
      setThemeValue,
      clearThemeEdits,
      apply,
      discard,
    }),
    // lockedThemeKeys derives from diff + canTheme
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, saved, draft, diff, canTheme, theme?.active, brandDriven, previewTheme, applying, setColors, setLook, setThemeValue, clearThemeEdits, apply, discard],
  );

  return (
    <BrandingDraftContext.Provider value={value}>
      {children}
      {/* Portaled: the page sits inside a transformed route transition, which
          would pin a fixed bar to the bottom of the page instead of the screen. */}
      {dirty && typeof document !== "undefined" && createPortal(<UnsavedChangesBar applicable={applicable} />, document.body)}
    </BrandingDraftContext.Provider>
  );
}

/** Pinned to the bottom of the screen while the draft differs from what is
 *  saved. Above the phone tab bar; beside the desktop rail. */
function UnsavedChangesBar({ applicable }: { applicable: boolean }) {
  const { diff, applying, apply, discard, lockedThemeKeys } = useBrandingDraft();
  const items = changeSummary(diff);
  const lockedOnly = !applicable && lockedThemeKeys.length > 0;
  const previewOnly = lockedThemeKeys.some((k) => PREVIEWABLE_THEME_KEYS.includes(k));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-6 lg:pl-[280px] lg:pr-8">
      <div
        role="region"
        aria-label="Unsaved branding changes"
        className="pl-card pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
      >
        <div className="min-w-0 flex-1 basis-48" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-bone">
            <span className="pl-led" data-on="true" aria-hidden />
            Unsaved changes
          </p>
          <p className="mt-0.5 truncate text-xs text-steel">
            {lockedOnly
              ? "Theme changes need the Max plan. They show in the preview only."
              : items.join(", ")}
            {!lockedOnly && previewOnly && ". Theme changes stay in the preview (Max plan)."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="xl:hidden"
            onClick={() => document.getElementById("brand-preview")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            <Eye className="size-4" />
            Preview
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={discard} disabled={applying}>
            Discard
          </Button>
          <Button type="button" size="sm" onClick={() => void apply()} disabled={applying || !applicable}>
            {applying ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
