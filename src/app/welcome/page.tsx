"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, ChevronRight, ImagePlus, Loader2 } from "lucide-react";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { slugify } from "@/components/agency/meta";

type StepKey = "basics" | "logo" | "contact" | "branding" | "rooms";
const STEPS: { key: StepKey; title: string; blurb: string }[] = [
  { key: "basics", title: "Studio basics", blurb: "Name your studio and its booking-page address." },
  { key: "logo", title: "Logo & color", blurb: "Upload your logo and pick an accent color." },
  { key: "contact", title: "Company info", blurb: "Contact details for invoices and your booking page." },
  { key: "branding", title: "Booking page", blurb: "The words clients see when they book you." },
  { key: "rooms", title: "First room", blurb: "Add a room so you can take bookings today." },
];

function errMsg(err: unknown, fallback: string) {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : ((err.data as { message?: string })?.message ?? fallback);
  }
  return fallback;
}

type Mine = NonNullable<FunctionReturnType<typeof api.onboarding.mine>>;

export default function WelcomePage() {
  const router = useRouter();
  const mine = useQuery(api.onboarding.mine, {});

  if (mine === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink text-ash">
        <Loader2 className="size-5 animate-spin text-gold" />
      </div>
    );
  }
  if (mine === null) {
    return (
      <div className="grid min-h-dvh place-items-center bg-ink px-4 text-center">
        <div className="max-w-sm space-y-4">
          <PulseLogo className="mx-auto h-7" />
          <p className="text-sm text-ash">
            We couldn’t find a studio for your account yet. If you just accepted an invite, give it
            a moment and refresh — or ask your agency to resend the invite.
          </p>
          <Button variant="secondary" size="sm" onClick={() => router.push("/dashboard")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  // Remount the wizard per studio so initial state seeds cleanly from `mine`
  // without a setState-in-effect cascade.
  return <Wizard key={mine.orgId} initial={mine} />;
}

function Wizard({ initial }: { initial: Mine }) {
  const router = useRouter();
  const saveBasics = useMutation(api.onboarding.saveBasics);
  const saveContact = useMutation(api.onboarding.saveContact);
  const updateOrg = useMutation(api.orgs.update);
  const addRoom = useMutation(api.onboarding.addRoom);
  const complete = useMutation(api.onboarding.complete);
  const generateUploadUrl = useMutation(api.orgs.generateUploadUrl);
  const setLogo = useMutation(api.orgs.setLogo);

  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(initial.logoUrl);

  // Seeded once from props (lazy initializers — no effect, no cascade).
  const [name, setName] = React.useState(initial.name === "New studio" ? "" : initial.name);
  const [slug, setSlug] = React.useState(initial.slug === "new-studio" ? "" : initial.slug);
  const [slugDirty, setSlugDirty] = React.useState(false);
  const [accent, setAccent] = React.useState(initial.accentColor || "#fdb913");
  const [legalName, setLegalName] = React.useState(initial.contact?.legalName || "");
  const [contactEmail, setContactEmail] = React.useState(initial.contact?.contactEmail || "");
  const [phone, setPhone] = React.useState(initial.contact?.phone || "");
  const [address, setAddress] = React.useState(initial.contact?.address || "");
  const [website, setWebsite] = React.useState(initial.contact?.website || "");
  const [tagline, setTagline] = React.useState(initial.tagline || "");
  const [bookingHeadline, setBookingHeadline] = React.useState(initial.bookingHeadline || "");
  const [bookingIntro, setBookingIntro] = React.useState(initial.bookingIntro || "");
  const [depositPolicyText, setDepositPolicyText] = React.useState(initial.depositPolicyText || "");
  const [roomName, setRoomName] = React.useState("");
  const [roomType, setRoomType] = React.useState("");
  const [roomRate, setRoomRate] = React.useState("");
  const [roomDeposit, setRoomDeposit] = React.useState("50");

  const effectiveSlug = slugDirty ? slug : slugify(name);

  function finishLater() {
    router.push("/dashboard");
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setLogo({ storageId });
      setLogoUrl(URL.createObjectURL(file));
      toast.success("Logo uploaded.");
    } catch (err) {
      toast.error(errMsg(err, "Could not upload that image."));
    } finally {
      setUploading(false);
    }
  }

  async function saveStep(): Promise<boolean> {
    const key = STEPS[step].key;
    setBusy(true);
    try {
      if (key === "basics") {
        await saveBasics({ name: name.trim(), slug: effectiveSlug, accentColor: accent });
      } else if (key === "contact") {
        await saveContact({ legalName, contactEmail, phone, address, website });
      } else if (key === "branding") {
        await updateOrg({ tagline, bookingHeadline, bookingIntro, depositPolicyText });
      } else if (key === "rooms") {
        if (roomName.trim()) {
          const cents = roomRate ? Math.round(parseFloat(roomRate) * 100) : undefined;
          await addRoom({
            name: roomName.trim(),
            roomType: roomType.trim() || undefined,
            hourlyRateCents: typeof cents === "number" && Number.isFinite(cents) ? cents : undefined,
            depositPct: roomDeposit ? Number(roomDeposit) : undefined,
          });
        }
      }
      // "logo" step persists immediately on upload — nothing to save here.
      return true;
    } catch (err) {
      toast.error(errMsg(err, "Could not save that step."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    const ok = await saveStep();
    if (!ok) return;
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      await complete({});
      toast.success("Your studio is set up. Welcome to Pulse!");
      router.push("/dashboard");
    }
  }

  const canAdvance =
    STEPS[step].key === "basics" ? name.trim().length > 1 && effectiveSlug.length > 1 : true;

  return (
    <div className="min-h-dvh bg-ink">
      <div className="app-bloom" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
        <div className="flex items-center justify-between">
          <PulseLogo className="h-6" />
          <button onClick={finishLater} className="text-xs font-medium text-ash transition-colors hover:text-bone">
            Finish later
          </button>
        </div>

        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono uppercase tracking-[0.18em] text-ash-dim">
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-ash">{STEPS[step].title}</span>
          </div>
          <Progress value={step + 1} max={STEPS.length} />
        </div>

        <div className="mt-8 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-bone">{STEPS[step].title}</h1>
          <p className="mt-1 text-sm text-ash">{STEPS[step].blurb}</p>

          <div className="mt-6 space-y-4">
            {STEPS[step].key === "basics" && (
              <>
                <Field label="Studio name" htmlFor="w-name">
                  <Input id="w-name" value={name} autoFocus placeholder="Skyline Sound"
                    onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Booking-page address" htmlFor="w-slug"
                  hint={`Clients book you at /book/${effectiveSlug || "your-studio"}`}>
                  <Input id="w-slug" value={effectiveSlug} placeholder="skyline-sound"
                    onChange={(e) => { setSlugDirty(true); setSlug(slugify(e.target.value)); }} />
                </Field>
              </>
            )}

            {STEPS[step].key === "logo" && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-hairline-2 bg-coal-2"
                    style={{ backgroundColor: logoUrl ? undefined : accent + "22" }}>
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="Studio logo" className="size-full object-cover" />
                    ) : (
                      <ImagePlus className="size-5 text-ash-dim" />
                    )}
                  </span>
                  <label className="cursor-pointer">
                    <span className="inline-flex h-9 items-center gap-2 rounded-md border border-hairline-2 bg-coal/60 px-3 text-xs font-medium text-ash transition-colors hover:border-gold-dim hover:text-bone">
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
                      {logoUrl ? "Replace logo" : "Upload logo"}
                    </span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                  </label>
                </div>
                <Field label="Accent color" htmlFor="w-accent" hint="Used across your studio + booking page.">
                  <div className="flex items-center gap-3">
                    <input id="w-accent" type="color" value={accent}
                      onChange={(e) => setAccent(e.target.value)}
                      className="size-9 cursor-pointer rounded-md border border-hairline-2 bg-transparent" />
                    <Input value={accent} onChange={(e) => setAccent(e.target.value)} className="font-mono" />
                  </div>
                </Field>
              </div>
            )}

            {STEPS[step].key === "contact" && (
              <>
                <Field label="Legal / business name" htmlFor="w-legal">
                  <Input id="w-legal" value={legalName} placeholder="Skyline Sound LLC"
                    onChange={(e) => setLegalName(e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Contact email" htmlFor="w-cemail">
                    <Input id="w-cemail" type="email" value={contactEmail} placeholder="hello@studio.com"
                      onChange={(e) => setContactEmail(e.target.value)} />
                  </Field>
                  <Field label="Phone" htmlFor="w-phone">
                    <Input id="w-phone" value={phone} placeholder="(555) 010-0100"
                      onChange={(e) => setPhone(e.target.value)} />
                  </Field>
                </div>
                <Field label="Address" htmlFor="w-addr">
                  <Input id="w-addr" value={address} placeholder="123 Main St, Atlanta, GA"
                    onChange={(e) => setAddress(e.target.value)} />
                </Field>
                <Field label="Website" htmlFor="w-web">
                  <Input id="w-web" value={website} placeholder="https://studio.com"
                    onChange={(e) => setWebsite(e.target.value)} />
                </Field>
              </>
            )}

            {STEPS[step].key === "branding" && (
              <>
                <Field label="Tagline" htmlFor="w-tag">
                  <Input id="w-tag" value={tagline} placeholder="Where the record gets made."
                    onChange={(e) => setTagline(e.target.value)} />
                </Field>
                <Field label="Booking headline" htmlFor="w-head">
                  <Input id="w-head" value={bookingHeadline} placeholder="Book time at Skyline"
                    onChange={(e) => setBookingHeadline(e.target.value)} />
                </Field>
                <Field label="Booking intro" htmlFor="w-intro">
                  <Textarea id="w-intro" value={bookingIntro} rows={2}
                    placeholder="Pick a room, choose your time, and lock it in with a deposit."
                    onChange={(e) => setBookingIntro(e.target.value)} />
                </Field>
                <Field label="Deposit policy" htmlFor="w-dep">
                  <Textarea id="w-dep" value={depositPolicyText} rows={2}
                    placeholder="A deposit holds your booking. The balance is due before your session."
                    onChange={(e) => setDepositPolicyText(e.target.value)} />
                </Field>
              </>
            )}

            {STEPS[step].key === "rooms" && (
              <>
                <p className="rounded-md border border-hairline bg-coal/40 px-3 py-2 text-xs text-ash-dim">
                  Optional — you can add rooms later in Settings. Adding one now lets you take bookings today.
                </p>
                <Field label="Room name" htmlFor="w-room">
                  <Input id="w-room" value={roomName} placeholder="Studio A — Live Room"
                    onChange={(e) => setRoomName(e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Type" htmlFor="w-rtype">
                    <Input id="w-rtype" value={roomType} placeholder="Live room"
                      onChange={(e) => setRoomType(e.target.value)} />
                  </Field>
                  <Field label="Rate / hr ($)" htmlFor="w-rate">
                    <Input id="w-rate" inputMode="decimal" value={roomRate} placeholder="120"
                      onChange={(e) => setRoomRate(e.target.value)} />
                  </Field>
                  <Field label="Deposit %" htmlFor="w-rdep">
                    <Input id="w-rdep" inputMode="numeric" value={roomDeposit} placeholder="50"
                      onChange={(e) => setRoomDeposit(e.target.value)} />
                  </Field>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-hairline pt-5">
          <Button variant="ghost" size="sm" disabled={step === 0 || busy}
            onClick={() => setStep((s) => Math.max(0, s - 1))}>
            Back
          </Button>
          <Button size="sm" disabled={!canAdvance || busy || uploading} onClick={next}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {step === STEPS.length - 1 ? (
              <>Finish<Check className="size-3.5" /></>
            ) : (
              <>Save &amp; continue<ChevronRight className="size-3.5" /></>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
