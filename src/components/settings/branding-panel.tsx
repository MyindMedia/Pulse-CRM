"use client";

import * as React from "react";
import { useMutation, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
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
import { Spinner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import { AssetUploader } from "@/components/settings/asset-uploader";
import { BookingLinkShare } from "@/components/settings/booking-link-share";
import { BrandColorsCard } from "@/components/settings/brand-colors-card";
import { extractBrandFromImage } from "@/lib/brand-theme";
import { type Org } from "@/components/settings/types";

const DEFAULT_HEADLINE = "Book studio time";

/** Branding settings - logo, accent color, identity and booking-page theming. */
export function BrandingPanel({ org }: { org: Org }) {
  const updateOrg = useMutation(api.orgs.update);
  const setLogo = useMutation(api.orgs.setLogo);
  const generateHero = useAction(api.brandHero.regenerate);
  const [generatingHero, setGeneratingHero] = React.useState(false);

  async function handleGenerateHero() {
    setGeneratingHero(true);
    try {
      await generateHero({});
      toast.success("AI hero generated from your brand. It now backs your booking page.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not generate the hero.");
    } finally {
      setGeneratingHero(false);
    }
  }
  const setBookingHero = useMutation(api.orgs.setBookingHero);
  const applyBrandFromLogo = useMutation(api.orgs.applyBrandFromLogo);

  // AssetUploader only hands back a storageId; we grab the File itself off
  // the bubbled change event from its internal <input type="file"> so we can
  // run client-side color extraction after a successful upload.
  const pendingLogoFileRef = React.useRef<File | null>(null);

  const [name, setName] = React.useState(org.name);
  const [tagline, setTagline] = React.useState(org.tagline);
  const [headline, setHeadline] = React.useState(org.bookingHeadline ?? "");
  const [intro, setIntro] = React.useState(org.bookingIntro ?? "");
  const [deposit, setDeposit] = React.useState(org.depositPolicyText ?? "");
  const [showGear, setShowGear] = React.useState(org.showGearOnBooking);
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
    setHeadline(org.bookingHeadline ?? "");
    setIntro(org.bookingIntro ?? "");
    setDeposit(org.depositPolicyText ?? "");
    setShowGear(org.showGearOnBooking);
  }

  // Brand colors live in their own card (BrandColorsCard) with their own save.
  const previewAccent = org.accentColor;

  const dirty =
    name.trim() !== org.name ||
    tagline.trim() !== org.tagline ||
    headline.trim() !== (org.bookingHeadline ?? "") ||
    intro.trim() !== (org.bookingIntro ?? "") ||
    deposit.trim() !== (org.depositPolicyText ?? "") ||
    showGear !== org.showGearOnBooking;

  const [matchingColors, setMatchingColors] = React.useState(false);

  /** Re-derive accent + palette from the CURRENT logo - covers logos that
   * arrived without extraction (e.g. imported from the studio's website by
   * the agency) and lets the studio re-run it anytime. Storage URLs allow
   * CORS, so the same canvas extraction used at upload works here. */
  async function matchColorsToLogo() {
    if (!org.logoUrl || matchingColors) return;
    setMatchingColors(true);
    try {
      const extracted = await extractBrandFromImage(org.logoUrl);
      if (!extracted) {
        toast.info("This logo reads as monochrome - pick brand colors below instead.");
        return;
      }
      await applyBrandFromLogo({
        accentColor: extracted.accent,
        palette: extracted.palette,
      });
      toast.success("Brand colors matched to your logo - fine-tune below anytime.");
    } catch {
      toast.error("Could not read colors from the logo.");
    } finally {
      setMatchingColors(false);
    }
  }

  async function handleLogo(storageId: Id<"_storage"> | Id<"mediaFiles">) {
    await setLogo({ storageId });
    // Auto-branding: pull an accent + palette out of the new logo. Any
    // failure here is non-fatal - the logo upload already succeeded, so
    // never let it bubble into AssetUploader's error toast.
    const file = pendingLogoFileRef.current;
    pendingLogoFileRef.current = null;
    if (!file) return;
    try {
      const extracted = await extractBrandFromImage(file);
      if (!extracted) return; // monochrome logo - keep the current accent
      await applyBrandFromLogo({
        accentColor: extracted.accent,
        palette: extracted.palette,
      });
      toast.success(
        "Brand colors matched to your logo - fine-tune below anytime.",
      );
    } catch {
      // Keep the manual accent flow untouched.
    }
  }
  async function handleHero(storageId: Id<"_storage"> | Id<"mediaFiles">) {
    await setBookingHero({ storageId });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("The studio needs a name.");
      return;
    }
    setSubmitting(true);
    try {
      await updateOrg({
        name: name.trim(),
        tagline: tagline.trim(),
        bookingHeadline: headline.trim(),
        bookingIntro: intro.trim(),
        depositPolicyText: deposit.trim(),
        showGearOnBooking: showGear,
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
    setHeadline(org.bookingHeadline ?? "");
    setIntro(org.bookingIntro ?? "");
    setDeposit(org.depositPolicyText ?? "");
  }

  const previewHeadline = headline.trim() || DEFAULT_HEADLINE;

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Shareable booking link */}
      <BookingLinkShare slug={org.slug} studioName={org.name} />

      {/* Logo + accent */}
      <Card>
        <CardHeader>
          <CardTitle>Studio brand</CardTitle>
          <CardDescription>
            The logo and studio name carry through the app and the public
            booking page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo */}
          <Field
            label="Logo"
            hint="A wide lockup, about 800 x 263 - the shape Playback's logo is. Transparent PNG, WEBP or SVG up to 5 MB."
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-graphite/60 bg-coal-2">
                {org.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.logoUrl}
                    alt={`${org.name} logo`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageIcon className="size-6 text-steel/70" />
                )}
              </div>
              <div
                className="space-y-1.5"
                onChange={(e) => {
                  // Capture the picked File from AssetUploader's internal
                  // input as the change event bubbles, for color extraction.
                  const target = e.target as HTMLInputElement;
                  const file = target?.files?.[0];
                  if (file) pendingLogoFileRef.current = file;
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AssetUploader label="Logo" onUploaded={handleLogo} />
                  {org.logoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={matchColorsToLogo}
                      disabled={matchingColors}
                    >
                      {matchingColors ? <Spinner /> : <Palette className="size-4" />}
                      Match colors to logo
                    </Button>
                  )}
                </div>
                {/*
                  The hint used to say "square works best", and it was wrong.
                  BrandLockup fills the sidebar rail's width and lets the height
                  follow, capping at 64px - so a wide lockup sits across the
                  rail as intended and a square crest gets letterboxed into a
                  64px block with dead space either side. Playback's logo is the
                  reference because it is the shape the rail was built around:
                  800 x 263, roughly 3:1, transparent.
                */}
                <p className="text-[0.6875rem] text-steel/70">
                  {org.logoUrl
                    ? "Uploading replaces the current logo immediately."
                    : "No logo yet - Pulse falls back to a disc mark."}{" "}
                  Roughly 3:1 is the shape to aim for; a square mark still works
                  but sits small in the rail.
                </p>
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
                placeholder="Myind Sound"
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

      <BrandColorsCard org={org} />

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
            hint="A wide room or console shot - or let AI create one in your brand colors. Uploading your own photo always overrides the generated one."
          >
            <div className="space-y-3">
              <div className="relative aspect-[21/9] w-full overflow-hidden rounded-md border border-graphite/60 bg-coal-2">
                {org.bookingHeroUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.bookingHeroUrl}
                    alt="Booking hero"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <ImageIcon className="size-8 text-steel/70" />
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AssetUploader label="Hero image" onUploaded={handleHero} purpose="photo" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={generatingHero}
                  onClick={() => void handleGenerateHero()}
                >
                  {generatingHero ? "Generating…" : "Generate with AI"}
                </Button>
              </div>
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

          {/* Gear list on the booking page. Off is a real answer: a studio
              whose kit is half in storage, or one that would rather talk
              about gear on a call, publishes nothing rather than a list it
              has to keep true. Off also means the list is never sent to the
              browser at all. */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <p className="font-grotesk text-sm font-semibold text-bone">Show gear on the booking page</p>
              <p className="text-xs text-steel">
                Clients see the room&apos;s equipment as a list under &ldquo;In this room&rdquo;.
                Turn it off and the section disappears.
              </p>
            </div>
            <Switch
              checked={showGear}
              onCheckedChange={setShowGear}
              aria-label="Show the gear list on the booking page"
            />
          </div>

          {/* Live preview */}
          <div className="space-y-2">
            <p className="overline">Preview</p>
            <div className="overflow-hidden rounded-lg border border-graphite/50 bg-obsidian">
              <div
                className="h-1.5 w-full"
                style={{ backgroundColor: previewAccent }}
                aria-hidden
              />
              <div className="flex items-start gap-4 p-5">
                <div
                  className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-graphite/60 bg-coal-2"
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
                  <p className="font-grotesk text-lg font-semibold tracking-tight text-bone">
                    {previewHeadline}
                  </p>
                  <p className="line-clamp-2 text-xs text-steel">
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

          <div className="flex items-start gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <p className="text-[0.6875rem] text-steel/70">
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
