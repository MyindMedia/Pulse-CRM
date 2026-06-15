"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  Disc3,
  Globe,
  Image as ImageIcon,
  Info,
  Lock,
  Palette,
} from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetUploader } from "@/components/settings/asset-uploader";
import { ACCENT_SWATCHES } from "@/components/settings/types";
import { cn } from "@/lib/utils";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const DEFAULT_ACCENT = "#E0A226";

/**
 * Agency white-label branding. The logo, accent and app name carry through
 * every sub-account's app shell; the custom domain is an Agency-tier perk.
 * Mirrors the studio BrandingPanel - logo uploads save immediately, text and
 * color save with the button.
 */
export default function BrandingPage() {
  const summary = useQuery(api.agencySettings.summary);
  const update = useMutation(api.branding.updateAgencyBranding);
  const setAgencyLogo = useMutation(api.branding.setAgencyLogo);

  const [accent, setAccent] = React.useState(DEFAULT_ACCENT);
  const [appName, setAppName] = React.useState("");
  const [customDomain, setCustomDomain] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Re-seed local state from the server record. A derived signature keeps
  // identity-only refreshes from clobbering in-progress edits.
  const sig = summary
    ? [summary.accentColor ?? "", summary.appName ?? "", summary.customDomain ?? ""].join("|")
    : null;
  const [prevSig, setPrevSig] = React.useState<string | null>(null);
  if (sig !== null && sig !== prevSig) {
    setPrevSig(sig);
    setAccent(summary?.accentColor || DEFAULT_ACCENT);
    setAppName(summary?.appName ?? "");
    setCustomDomain(summary?.customDomain ?? "");
  }

  const accentTrim = accent.trim();
  const accentValid = HEX_RE.test(accentTrim);
  const normalizedAccent = accentTrim.startsWith("#") ? accentTrim : `#${accentTrim}`;
  const previewAccent = accentValid ? normalizedAccent : summary?.accentColor || DEFAULT_ACCENT;
  const domainAvailable = summary?.customDomainAvailable ?? true;

  const dirty =
    !!summary &&
    ((accentValid && normalizedAccent.toLowerCase() !== (summary.accentColor ?? "").toLowerCase()) ||
      appName.trim() !== (summary.appName ?? "") ||
      customDomain.trim() !== (summary.customDomain ?? ""));

  async function handleLogo(storageId: Id<"_storage">) {
    await setAgencyLogo({ storageId });
  }

  async function save() {
    if (!accentValid) {
      toast.error("Accent color must be a 6-digit hex value.");
      return;
    }
    setSaving(true);
    try {
      await update({
        accentColor: normalizedAccent,
        appName: appName.trim() || undefined,
        customDomain: domainAvailable ? customDomain.trim() || undefined : undefined,
      });
      toast.success("Branding saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save branding.");
    } finally {
      setSaving(false);
    }
  }

  if (summary === undefined) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const brandName = appName.trim() || summary?.name || "Your agency";

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Agency"
        title="Branding"
        description="Your white-label logo, accent color, and app name carry through every studio you run. A custom domain comes with the Agency tier."
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Editor */}
        <Section title="White-label">
          <Card>
            <CardHeader>
              <CardTitle>Agency brand</CardTitle>
              <CardDescription>
                The logo and accent color theme the app shell your studios see.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Logo */}
              <Field label="Logo" hint="Square works best. PNG, JPG, WEBP or SVG up to 5 MB.">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-graphite/60 bg-coal-2">
                    {summary?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={summary.logoUrl}
                        alt={`${brandName} logo`}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="size-6 text-steel/70" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <AssetUploader
                      label="Logo"
                      onUploaded={handleLogo}
                      uploadUrlMutation={api.agencyProfile.generateUploadUrl}
                    />
                    <p className="text-[0.6875rem] text-steel/70">
                      {summary?.logoUrl
                        ? "Uploading replaces the current logo immediately."
                        : "No logo yet - Pulse falls back to a disc mark."}
                    </p>
                  </div>
                </div>
              </Field>

              {/* Accent color */}
              <Field label="Accent color" hint="Pick a swatch or enter a 6-digit hex value.">
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {ACCENT_SWATCHES.map((s) => {
                      const active = normalizedAccent.toLowerCase() === s.value.toLowerCase();
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setAccent(s.value)}
                          title={s.label}
                          aria-label={s.label}
                          className={cn(
                            "grid size-8 place-items-center rounded-md border transition-transform",
                            active ? "border-bone scale-105" : "border-graphite/60 hover:scale-105",
                          )}
                          style={{ backgroundColor: s.value }}
                        >
                          {active && <Check className="size-4 text-ink" strokeWidth={3} />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-9 shrink-0 rounded-md border border-graphite/60"
                      style={{ backgroundColor: accentValid ? normalizedAccent : "transparent" }}
                      aria-hidden
                    />
                    <Input
                      value={accent}
                      onChange={(e) => setAccent(e.target.value)}
                      placeholder="#E0A226"
                      className={cn(
                        "max-w-40 font-meta",
                        !accentValid && accentTrim !== "" && "border-critical/50",
                      )}
                      aria-label="Accent color hex"
                    />
                    {!accentValid && accentTrim !== "" && (
                      <span className="text-[0.6875rem] text-critical">Enter a 6-digit hex.</span>
                    )}
                  </div>
                </div>
              </Field>

              {/* App name */}
              <Field
                label="App name"
                htmlFor="ag-appname"
                hint="Shown in your studios' nav. Defaults to Pulse."
              >
                <Input
                  id="ag-appname"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="Pulse, AcmeOS, …"
                />
              </Field>

              {/* Custom domain */}
              <Field
                label="Custom domain"
                htmlFor="ag-domain"
                hint={
                  domainAvailable
                    ? "Point your own domain at your studios' app."
                    : "Available on the Agency tier."
                }
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-graphite/60 bg-coal-2 text-steel">
                    {domainAvailable ? <Globe className="size-4" /> : <Lock className="size-4" />}
                  </span>
                  <Input
                    id="ag-domain"
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder="app.acme.com"
                    disabled={!domainAvailable}
                  />
                </div>
              </Field>

              <div className="flex items-start gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
                <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
                <p className="text-[0.6875rem] text-steel/70">
                  Logo uploads save immediately. Accent, app name and domain save with the button
                  below.
                </p>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void save()} disabled={saving || !dirty}>
                <Palette className="size-4" />
                {saving ? "Saving…" : "Save branding"}
              </Button>
            </CardFooter>
          </Card>
        </Section>

        {/* Live preview */}
        <Section title="Preview">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="text-[0.6875rem] text-steel/70">How your studios see the app shell.</p>
              <div className="overflow-hidden rounded-lg border border-graphite/50 bg-obsidian">
                <div className="h-1.5 w-full" style={{ backgroundColor: previewAccent }} aria-hidden />
                <div className="flex items-center gap-3 p-4">
                  <div
                    className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-graphite/60 bg-coal-2"
                    style={{ boxShadow: `0 0 0 1px ${previewAccent}33` }}
                  >
                    {summary?.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={summary.logoUrl} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <Disc3 className="size-5" style={{ color: previewAccent }} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-grotesk text-sm font-semibold tracking-tight text-bone">
                      {brandName}
                    </p>
                    <p className="truncate text-[0.6875rem] text-steel">
                      {customDomain.trim() || "yourstudio.pulse.app"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Badge tone="gold" className="capitalize">
                  {summary?.plan} plan
                </Badge>
                {!domainAvailable && (
                  <span className="inline-flex items-center gap-1 text-[0.6875rem] text-steel/70">
                    <Lock className="size-3" /> Domain locked
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </Section>
      </div>
    </div>
  );
}
