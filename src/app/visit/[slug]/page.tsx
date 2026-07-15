"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2, Disc3, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { brandStyle } from "@/lib/brand-theme";
import { timeOfDay, longDate } from "@/lib/format";

/*
 * Visitor self check-in - the page behind the front-desk QR code
 * (/visit/<slug>). PUBLIC: the org comes from the slug, mirroring the public
 * booking pages; the register mutation is rate-limited server-side. Built for
 * a guest holding their phone after a scan: big targets, one screen, and a
 * success state that resets itself for the next visitor.
 */

const PURPOSES = ["Session", "Meeting", "Studio tour", "Delivery", "Pickup", "Other"];
const RESET_AFTER_MS = 9_000;

/** The visitor terms shown behind the required check-in checkbox. Generic
    enough for any studio; acceptance is stamped on the visit record. */
const VISITOR_TERMS = [
  "I am visiting the premises as a guest and will follow staff instructions, posted safety notices, and studio etiquette at all times.",
  "Studio areas may contain sensitive audio equipment and active recording sessions. I will not touch equipment or enter live rooms without permission.",
  "I will not photograph, record, or share unreleased material I see or hear during my visit without the studio's written consent.",
  "The studio is not responsible for loss of or damage to my personal belongings, and I am responsible for any damage I cause to studio property.",
  "The contact details I provide will be used to log my visit, notify my host, and follow up about studio services. I can request removal of my details at any time.",
] as const;

export default function VisitPage() {
  const params = useParams<{ slug: string }>();
  const slug = Array.isArray(params?.slug) ? params.slug[0] : params?.slug;
  const studio = useQuery(api.orgs.getBySlug, slug ? { slug } : "skip");
  const register = useMutation(api.visitors.register);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [purposeChip, setPurposeChip] = useState("");
  const [purposeNote, setPurposeNote] = useState("");
  const [hostName, setHostName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    name: string;
    at: number;
    session: { title: string; startTime: number; status: string } | null;
  } | null>(null);

  // After a successful check-in the screen resets itself so the next guest
  // can scan and go - the page may be left open on a lobby device.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), RESET_AFTER_MS);
    return () => clearTimeout(timer);
  }, [done]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setBusy(true);
    setError(null);
    // Chip + free-text detail combine into one purpose line for the log.
    const purpose = [purposeChip, purposeNote.trim()].filter(Boolean).join(" - ");
    try {
      const result = await register({
        slug,
        name,
        email,
        phone: phone.trim() || undefined,
        purpose: purpose || undefined,
        hostName: hostName.trim() || undefined,
        termsAccepted,
      });
      setDone({ name: name.trim(), at: Date.now(), session: result.session });
      setName("");
      setEmail("");
      setPhone("");
      setPurposeChip("");
      setPurposeNote("");
      setHostName("");
      setTermsAccepted(false);
      setTermsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
    } finally {
      setBusy(false);
    }
  }

  const studioName = studio?.name ?? "the studio";

  return (
    <div
      className="grain relative flex min-h-dvh flex-col bg-ink text-bone"
      style={brandStyle(studio?.accentColor)}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(253,185,19,0.10),transparent_70%)]"
      />

      <header className="relative z-10 border-b border-graphite/50 bg-obsidian/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-xl items-center gap-2.5 px-4">
          {studio?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={studio.logoUrl} alt="" className="size-8 rounded object-contain" />
          ) : (
            <span className="grid size-9 place-items-center rounded-md bg-gold text-gold-ink">
              <Disc3 className="size-5" />
            </span>
          )}
          <span className="flex flex-col leading-none">
            <span className="font-grotesk text-sm font-semibold tracking-tight">
              {studio?.name ?? "Pulse"}
            </span>
            <span className="overline mt-0.5">Visitor check-in</span>
          </span>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-xl flex-1 px-4 py-8">
        {studio === null ? (
          <div className="rounded-lg border border-graphite/50 bg-coal p-8 text-center">
            <p className="font-grotesk text-lg font-semibold">This check-in link isn&apos;t active</p>
            <p className="mt-2 text-sm text-steel/70">Ask the front desk for help signing in.</p>
          </div>
        ) : done ? (
          <div className="rounded-lg border border-gold-dim/50 bg-gold/[0.06] p-10 text-center">
            <CheckCircle2 className="mx-auto size-14 text-gold-bright" />
            <h1 className="mt-4 font-grotesk text-2xl font-bold tracking-tight">
              You&apos;re checked in{done.name ? `, ${done.name.split(" ")[0]}` : ""}
            </h1>
            {done.session ? (
              <p className="mt-2 text-sm text-steel/70">
                We found your booking - <span className="text-bone">{done.session.title}</span> at{" "}
                {timeOfDay(done.session.startTime)}
                {done.session.status === "in_progress"
                  ? " is checked in and ready to roll."
                  : " is confirmed and the team knows you're here."}
              </p>
            ) : (
              <p className="mt-2 text-sm text-steel/70">
                {longDate(done.at)} · {timeOfDay(done.at)} - the {studioName} team knows you&apos;re
                here. Take a seat and make yourself at home.
              </p>
            )}
            <Button variant="outline" className="mt-6" onClick={() => setDone(null)}>
              Check in another visitor
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="font-grotesk text-2xl font-bold tracking-tight">
                Welcome{studio ? ` to ${studio.name}` : ""}
              </h1>
              <p className="mt-1.5 text-sm text-steel/70">
                Sign in below so the team knows you&apos;re here.
              </p>
            </div>

            <Field label="Your name" htmlFor="visit-name">
              <Input
                id="visit-name"
                className="h-12 text-base"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
            <Field label="Email" htmlFor="visit-email">
              <Input
                id="visit-email"
                type="email"
                className="h-12 text-base"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Phone (optional)" htmlFor="visit-phone">
              <Input
                id="visit-phone"
                type="tel"
                className="h-12 text-base"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>

            <Field label="What brings you in?" htmlFor="visit-purpose">
              <div className="flex flex-wrap gap-2">
                {PURPOSES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPurposeChip(purposeChip === p ? "" : p)}
                    className={cn(
                      "min-h-11 rounded-md border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
                      purposeChip === p
                        ? "border-gold-dim/60 bg-gold/15 text-gold-bright"
                        : "border-graphite/50 bg-coal text-steel hover:text-bone",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Textarea
                id="visit-purpose"
                className="mt-2 text-base"
                rows={2}
                placeholder="Any details about your visit (optional)"
                value={purposeNote}
                onChange={(e) => setPurposeNote(e.target.value)}
              />
            </Field>

            <Field label="Here to see (optional)" htmlFor="visit-host">
              <Input
                id="visit-host"
                className="h-12 text-base"
                placeholder="Who's expecting you?"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />
            </Field>

            {/* Visitor terms - required to check in; the server enforces it too. */}
            <div className="rounded-md border border-graphite/50 bg-coal-2">
              <label className="flex cursor-pointer items-start gap-3 p-3.5">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-gold"
                  required
                />
                <span className="text-sm text-bone">
                  I agree to the{" "}
                  <button
                    type="button"
                    onClick={() => setTermsOpen((o) => !o)}
                    className="font-medium text-gold-bright underline decoration-gold-dim underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
                  >
                    visitor terms
                  </button>{" "}
                  of {studioName}.
                </span>
              </label>
              {termsOpen && (
                <ul className="space-y-2 border-t border-graphite/50 px-3.5 py-3 text-xs leading-relaxed text-steel/70">
                  {VISITOR_TERMS.map((term, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="text-gold-dim">
                        {i + 1}.
                      </span>
                      <span>{term}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && <p className="text-sm text-critical">{error}</p>}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={busy || !slug || !termsAccepted}
            >
              <UserCheck className="size-5" />
              {busy ? "Checking you in..." : "Check in"}
            </Button>

            <p className="text-center text-xs text-steel/50">
              Your details go to {studioName} so they can greet you and follow up about your visit.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
