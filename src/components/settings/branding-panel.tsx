"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  Disc3,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Palette,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { AssetUploader } from "@/components/settings/asset-uploader";
import { cn } from "@/lib/utils";
import { ACCENT_SWATCHES, type Org } from "@/components/settings/types";

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const DEFAULT_HEADLINE = "Book studio time";

/** Branding settings - logo, accent color, identity and booking-page theming. */
export function BrandingPanel({ org }: { org: Org }) {
  const updateOrg = useMutation(api.orgs.update);
  const setLogo = useMutation(api.orgs.setLogo);
  const setBookingHero = useMutation(api.orgs.setBookingHero);

  const [name, setName] = React.useState(org.name);
  const [tagline, setTagline] = React.useState(org.tagline);
  const [accent, setAccent] = React.useState(org.accentColor);
  const [headline, setHeadline] = React.useState(org.bookingHeadline ?? "");
  const [intro, setIntro] = React.useState(org.bookingIntro ?? "");
  const [deposit, setDeposit] = React.useState(org.depositPolicyText ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed local state if the org record changes underneath us. We track a
  // derived signature of the watched fields so identity-only changes don't
  // clobber in-progress edits.
  const orgSig = [
    org.name,
    org.tagline,
    org.accentColor,
    org.bookingHeadline ?? "",
    org.bookingIntro ?? "",
    org.depositPolicyText ?? "",
  ].join("");
  const [prevOrgSig, setPrevOrgSig] = React.useState(orgSig);
  if (prevOrgSig !== orgSig) {
    setPrevOrgSig(orgSig);
    setName(org.name);
    setTagline(org.tagline);
    setAccent(org.accentColor);
    setHeadline(org.bookingHeadline ?? "");
    setIntro(org.bookingIntro ?? "");
    setDeposit(org.depositPolicyText ?? "");
  }

  const accentTrim = accent.trim();
  const accentValid = HEX_RE.test(accentTrim);
  const normalizedAccent = accentTrim.startsWith("#")
    ? accentTrim
    : `#${accentTrim}`;
  const previewAccent = accentValid ? normalizedAccent : org.accentColor;

  const dirty =
    name.trim() !== org.name ||
    tagline.trim() !== org.tagline ||
    (accentValid &&
      normalizedAccent.toLowerCase() !== org.accentColor.toLowerCase()) ||
    headline.trim() !== (org.bookingHeadline ?? "") ||
    intro.trim() !== (org.bookingIntro ?? "") ||
    deposit.trim() !== (org.depositPolicyText ?? "");

  async function handleLogo(storageId: Id<"_storage">) {
    await setLogo({ storageId });
  }
  async function handleHero(storageId: Id<"_storage">) {
    await setBookingHero({ storageId });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("The studio needs a name.");
      return;
    }
    if (!accentValid) {
      toast.error("Accent color must be a 6-digit hex value.");
      return;
    }
    setSubmitting(true);
    try {
      await updateOrg({
        name: name.trim(),
        tagline: tagline.trim(),
        accentColor: normalizedAccent,
        bookingHeadline: headline.trim(),
        bookingIntro: intro.trim(),
        depositPolicyText: deposit.trim(),
      });
      toast.success("Branding saved.");
    } catch {
      toast.error("Could not save branding. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setName(org.name);
    setTagline(org.tagline);
    setAccent(org.accentColor);
    setHeadline(org.bookingHeadline ?? "");
    setIntro(org.bookingIntro ?? "");
    setDeposit(org.depositPolicyText ?? "");
  }

  const previewHeadline = headline.trim() || DEFAULT_HEADLINE;

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Logo + accent */}
      <Card>
        <CardHeader>
          <CardTitle>Studio brand</CardTitle>
          <CardDescription>
            The logo and accent color carry through the app and the public
            booking page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo */}
          <Field
            label="Logo"
            hint="Square works best. PNG, JPG, WEBP or SVG up to 5 MB."
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-hairline-2 bg-coal-2">
                {org.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.logoUrl}
                    alt={`${org.name} logo`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="size-6 text-ash-dim" />
                )}
              </div>
              <div className="space-y-1.5">
                <AssetUploader label="Logo" onUploaded={handleLogo} />
                <p className="text-[0.6875rem] text-ash-dim">
                  {org.logoUrl
                    ? "Uploading replaces the current logo immediately."
                    : "No logo yet - Pulse falls back to a disc mark."}
                </p>
              </div>
            </div>
          </Field>

          {/* Accent color */}
          <Field
            label="Accent color"
            hint="Pick a swatch or enter a 6-digit hex value."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {ACCENT_SWATCHES.map((s) => {
                  const active =
                    normalizedAccent.toLowerCase() === s.value.toLowerCase();
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setAccent(s.value)}
                      title={s.label}
                      aria-label={s.label}
                      className={cn(
                        "grid size-8 place-items-center rounded-md border transition-transform",
                        active
                          ? "border-bone scale-105"
                          : "border-hairline-2 hover:scale-105",
                      )}
                      style={{ backgroundColor: s.value }}
                    >
                      {active && (
                        <Check className="size-4 text-ink" strokeWidth={3} />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="size-9 shrink-0 rounded-md border border-hairline-2"
                  style={{
                    backgroundColor: accentValid
                      ? normalizedAccent
                      : "transparent",
                  }}
                  aria-hidden
                />
                <Input
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  placeholder="#E0A226"
                  className={cn(
                    "max-w-40 font-mono",
                    !accentValid &&
                      accentTrim !== "" &&
                      "border-critical/50",
                  )}
                  aria-label="Accent color hex"
                />
                {!accentValid && accentTrim !== "" && (
                  <span className="text-[0.6875rem] text-critical">
                    Enter a 6-digit hex.
                  </span>
                )}
              </div>
            </div>
          </Field>

          {/* Identity */}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Studio name" htmlFor="brand-name">
              <Input
                id="brand-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lumen Recording Co."
                required
              />
            </Field>
            <Field
              label="Tagline"
              htmlFor="brand-tagline"
              hint="A short line shown alongside the studio name."
            >
              <Input
                id="brand-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Where the record gets made."
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Booking page */}
      <Card>
        <CardHeader>
          <CardTitle>Booking page</CardTitle>
          <CardDescription>
            What clients see at the public studio front.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Field
            label="Hero image"
            hint="A wide room or console shot. PNG, JPG or WEBP up to 5 MB."
          >
            <div className="space-y-3">
              <div className="relative aspect-[21/9] w-full overflow-hidden rounded-md border border-hairline-2 bg-coal-2">
                {org.bookingHeroUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.bookingHeroUrl}
                    alt="Booking hero"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <ImageIcon className="size-8 text-ash-dim" />
                  </div>
                )}
              </div>
              <AssetUploader label="Hero image" onUploaded={handleHero} />
            </div>
          </Field>

          <Field
            label="Headline"
            htmlFor="brand-headline"
            hint={`Shown large at the top of the booking page. Defaults to "${DEFAULT_HEADLINE}".`}
          >
            <Input
              id="brand-headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder={DEFAULT_HEADLINE}
            />
          </Field>

          <Field
            label="Intro"
            htmlFor="brand-intro"
            hint="A short paragraph under the headline."
          >
            <Textarea
              id="brand-intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="Tracking rooms, vintage gear and an engineer who knows the desk."
              className="min-h-20"
            />
          </Field>

          <Field
            label="Deposit policy"
            htmlFor="brand-deposit"
            hint="A note about the hold deposit, shown near the rooms."
          >
            <Textarea
              id="brand-deposit"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              placeholder="A deposit holds your slot and is credited to the final invoice."
              className="min-h-16"
            />
          </Field>

          {/* Live preview */}
          <div className="space-y-2">
            <p className="overline">Preview</p>
            <div className="overflow-hidden rounded-lg border border-hairline bg-ink-2">
              <div
                className="h-1.5 w-full"
                style={{ backgroundColor: previewAccent }}
                aria-hidden
              />
              <div className="flex items-start gap-4 p-5">
                <div
                  className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-hairline-2 bg-coal-2"
                  style={{ boxShadow: `0 0 0 1px ${previewAccent}33` }}
                >
                  {org.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={org.logoUrl}
                      alt=""
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Disc3
                      className="size-6"
                      style={{ color: previewAccent }}
                    />
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p
                    className="text-[0.6875rem] font-medium uppercase tracking-[0.18em]"
                    style={{ color: previewAccent }}
                  >
                    {name.trim() || org.name}
                  </p>
                  <p className="font-display text-lg font-semibold tracking-tight text-bone">
                    {previewHeadline}
                  </p>
                  <p className="line-clamp-2 text-xs text-ash">
                    {intro.trim() ||
                      tagline.trim() ||
                      "Your booking page intro shows here."}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <Button asChild variant="ghost" size="sm">
                <a
                  href={`/book/${org.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="size-4" />
                  Open booking page
                </a>
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <p className="text-[0.6875rem] text-ash-dim">
              Logo and hero uploads save immediately. Text and color changes
              save with the button below.
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={submitting || !dirty}
          >
            Reset
          </Button>
          <Button type="submit" disabled={submitting || !dirty}>
            <Palette className="size-4" />
            {submitting ? "Saving…" : "Save branding"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
