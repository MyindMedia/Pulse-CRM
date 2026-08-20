"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import {
  motion, AnimatePresence, useMotionValue, useSpring, useTransform,
  useScroll, useReducedMotion,
} from "motion/react";
import { api } from "@convex/_generated/api";
import { Check, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/* Claiming a studio.

   The one screen in the product that is allowed to feel like an occasion:
   somebody has read the terms, signed them, seen the whole product, and is
   now deciding to build on it.

   The parallax is pointer- and scroll-driven, on decorative layers only.
   Nothing that carries meaning moves, so the screen still works at
   prefers-reduced-motion, where every layer is pinned and the transitions
   collapse to opacity. */

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <Claim />
    </Suspense>
  );
}

type Step = "name" | "address" | "done";

function Claim() {
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code") ?? "";

  const check = useQuery(api.betaAccess.check, code ? { code } : "skip");
  const claim = useAction(api.betaAccess.claim);

  const [step, setStep] = React.useState<Step>("name");
  const [studioName, setStudioName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [inviteToken, setInviteToken] = React.useState<string | null>(null);
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Prefill from the invite once, then leave both fields under the user's hand.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current || !check?.valid) return;
    seeded.current = true;
    if (check.suggestedName) setStudioName(check.suggestedName);
  }, [check]);

  // The address follows the name until the moment they edit it themselves.
  const autoSlug = React.useMemo(
    () => studioName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    [studioName],
  );
  const effectiveSlug = slugTouched ? slug : autoSlug;
  const slugCheck = useQuery(
    api.betaAccess.slugAvailable,
    effectiveSlug.length >= 2 ? { slug: effectiveSlug } : "skip",
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await claim({ code, studioName, slug: effectiveSlug });
      setSlug(res.slug);
      setInviteToken(res.inviteToken);
      setStep("done");
    } catch (e) {
      const d = (e as { data?: { message?: string } })?.data;
      setError(d?.message ?? "That did not go through. Try again.");
      setBusy(false);
    }
  }

  if (!code) {
    return <Stage><p className="text-sm text-steel">No access code on this link.</p></Stage>;
  }
  if (check && !check.valid) {
    return <Stage><p className="text-sm text-steel">That access code is no longer open.</p></Stage>;
  }
  if (check?.valid && !check.signed) {
    return (
      <Stage>
        <p className="text-sm text-steel">Sign the agreement first.</p>
        <Button className="mt-4" onClick={() => router.push(`/preview?code=${code}`)}>
          Back to the preview
        </Button>
      </Stage>
    );
  }
  if (check?.claimed && step !== "done") {
    return (
      <Stage>
        <p className="text-sm text-steel">
          You already have a studio at <span className="text-bone">/{check.claimedSlug}</span>.
        </p>
        <Button className="mt-4" onClick={() => router.push(`/book/${check.claimedSlug}`)}>
          Open your booking page
        </Button>
      </Stage>
    );
  }

  return (
    <Stage>
      <Progress step={step} />

      <AnimatePresence mode="wait">
        {step === "name" && (
          <Panel key="name">
            <Eyebrow>Step one</Eyebrow>
            <Headline>What is the studio called?</Headline>
            <Sub>The name your clients already know you by. You can change it later.</Sub>
            <input
              value={studioName}
              onChange={(e) => setStudioName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && studioName.trim().length >= 2) setStep("address");
              }}
              placeholder="Vault Studios"
              autoFocus
              aria-label="Studio name"
              className="mt-7 w-full border-b-2 border-graphite/60 bg-transparent pb-3 font-grotesk text-2xl text-bone outline-none transition-colors placeholder:text-steel/30 focus:border-gold sm:text-3xl"
            />
            <Button
              className="mt-8"
              disabled={studioName.trim().length < 2}
              onClick={() => setStep("address")}
            >
              Continue
              <ArrowRight className="ml-1.5 size-4" />
            </Button>
          </Panel>
        )}

        {step === "address" && (
          <Panel key="address">
            <Eyebrow>Step two</Eyebrow>
            <Headline>Pick your booking address.</Headline>
            <Sub>This is where clients land to book you. Short is better.</Sub>

            <div className="mt-7 flex flex-wrap items-baseline gap-1 border-b-2 border-graphite/60 pb-3 transition-colors focus-within:border-gold">
              <span className="font-mono text-base text-steel/60">studiopulse.tech/book/</span>
              <input
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                }}
                placeholder="vault"
                autoFocus
                aria-label="Booking address"
                className="min-w-[8ch] flex-1 bg-transparent font-mono text-xl text-bone outline-none placeholder:text-steel/30 sm:text-2xl"
              />
            </div>

            <div className="mt-3 h-5 text-xs" aria-live="polite">
              {effectiveSlug.length < 2 ? (
                <span className="text-steel/60">A couple of characters at least.</span>
              ) : slugCheck === undefined ? (
                <span className="text-steel/60">Checking…</span>
              ) : slugCheck.ok ? (
                <span className="flex items-center gap-1.5 text-positive">
                  <Check className="size-3.5" />
                  /{slugCheck.slug} is free
                </span>
              ) : (
                <span className="text-caution">
                  {slugCheck.reason === "taken"
                    ? `/${slugCheck.slug} is taken. Try another.`
                    : "Too short."}
                </span>
              )}
            </div>

            {error && <p className="mt-2 text-xs text-critical" role="alert">{error}</p>}

            <div className="mt-8 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStep("name")}>Back</Button>
              <Button disabled={!slugCheck?.ok || busy} onClick={submit}>
                {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Sparkles className="mr-1.5 size-4" />}
                {busy ? "Building your studio…" : "Build my studio"}
              </Button>
            </div>
          </Panel>
        )}

        {step === "done" && (
          <Panel key="done">
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
              className="grid size-14 place-items-center rounded-2xl bg-gold text-gold-ink"
            >
              <Check className="size-7" strokeWidth={3} />
            </motion.span>
            <Headline className="mt-6">{studioName} is live.</Headline>
            <Sub>
              Your booking page is up at{" "}
              <span className="font-mono text-bone">studiopulse.tech/book/{slug}</span>. One
              thing left: create your login, and the studio is yours.
            </Sub>
            <div className="mt-8 flex flex-wrap gap-2">
              {/* Creating the login is what attaches this person to the
                  workspace. Sending them to /welcome first leaves them signed
                  out of a studio that exists but that they cannot open. */}
              <Button
                onClick={() =>
                  router.push(inviteToken ? `/invite/${inviteToken}` : "/sign-up")
                }
              >
                Create my login
                <ArrowRight className="ml-1.5 size-4" />
              </Button>
              <Button variant="ghost" onClick={() => router.push(`/book/${slug}`)}>
                See my booking page
              </Button>
            </div>
          </Panel>
        )}
      </AnimatePresence>
    </Stage>
  );
}

/* ── The stage: parallax background, static foreground ───────── */

function Stage({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);

  // Pointer position, normalized to -1..1 and smoothed, so the layers drift
  // rather than snap to the cursor.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 20, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 60, damping: 20, mass: 0.6 });

  const { scrollYProgress } = useScroll();
  const scrollDrift = useTransform(scrollYProgress, [0, 1], [0, -80]);

  // Three depths. The further back, the more it moves - the inversion of what
  // real parallax does, on purpose: it reads as atmosphere rather than as a
  // camera move, which is what a form wants behind it.
  const farX = useTransform(sx, (v) => v * 34);
  const farY = useTransform(sy, (v) => v * 26);
  const midX = useTransform(sx, (v) => v * 18);
  const midY = useTransform(sy, (v) => v * 14);
  const nearX = useTransform(sx, (v) => v * 7);
  const nearY = useTransform(sy, (v) => v * 5);

  function onPointerMove(e: React.PointerEvent) {
    if (reduced) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    px.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    py.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  }

  const still = { x: 0, y: 0 };

  return (
    <main
      ref={ref}
      onPointerMove={onPointerMove}
      className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink px-5 py-16"
    >
      {/* Decorative only: every layer here is aria-hidden and carries no
          information, so pinning them changes nothing but the mood. */}
      <motion.div
        aria-hidden
        style={reduced ? still : { x: farX, y: farY, translateY: scrollDrift }}
        className="pointer-events-none absolute -left-40 -top-40 size-[42rem] rounded-full bg-gold/[0.07] blur-[120px]"
      />
      <motion.div
        aria-hidden
        style={reduced ? still : { x: midX, y: midY }}
        className="pointer-events-none absolute -bottom-56 -right-32 size-[38rem] rounded-full bg-gold/[0.05] blur-[100px]"
      />
      <motion.div
        aria-hidden
        style={reduced ? still : { x: nearX, y: nearY }}
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
      >
        <div
          className="size-full"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </motion.div>

      <div className="relative w-full max-w-xl">
        <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-gold">Pulse</p>
        {children}
      </div>
    </main>
  );
}

function Progress({ step }: { step: Step }) {
  const order: Step[] = ["name", "address", "done"];
  const i = order.indexOf(step);
  return (
    <div className="mt-6 flex items-center gap-2" aria-hidden>
      {order.map((s, n) => (
        <motion.span
          key={s}
          className="h-0.5 flex-1 origin-left rounded-full bg-graphite/60"
          animate={{ backgroundColor: n <= i ? "#FDB913" : "rgba(120,116,108,0.35)" }}
          transition={{ duration: 0.4 }}
        />
      ))}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, filter: "blur(6px)" }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -18, filter: "blur(6px)" }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="pt-8"
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-meta text-[0.65rem] uppercase tracking-[0.14em] text-steel/70">{children}</p>
  );
}

function Headline({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1
      className={`mt-2 font-grotesk text-3xl font-bold leading-tight tracking-tight text-bone sm:text-4xl ${className ?? ""}`}
    >
      {children}
    </h1>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-steel">{children}</p>;
}
