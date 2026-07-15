"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Dancing_Script, Great_Vibes, Caveat, Homemade_Apple } from "next/font/google";
import { Loader2, ShieldCheck, CheckCircle2, AlertTriangle, Eraser, PenLine, Type } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Public split-sheet signing page (/sign/<token>, token-authed magic link).
 * The signature itself is a real e-signature, captured one of two ways:
 *   - Type: the signer's full legal name rendered in a script font they pick
 *     from a gallery (the classic "select your signature style" flow).
 *   - Draw: a finger/stylus/mouse signature pad; stored as a PNG data URI.
 * Both stamp signedAt + user-agent server-side for the audit record.
 */

// The four script voices behind the typed-signature gallery. Keys must match
// the server's SIGNATURE_FONTS allowlist in convex/splitSignatures.ts.
const dancingScript = Dancing_Script({ subsets: ["latin"], weight: "600" });
const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400" });
const caveat = Caveat({ subsets: ["latin"], weight: "600" });
const homemadeApple = Homemade_Apple({ subsets: ["latin"], weight: "400" });

const SIGNATURE_STYLES = [
  { key: "dancing-script", label: "Flowing", className: dancingScript.className, size: "text-3xl" },
  { key: "great-vibes", label: "Elegant", className: greatVibes.className, size: "text-3xl" },
  { key: "caveat", label: "Casual", className: caveat.className, size: "text-3xl" },
  { key: "homemade-apple", label: "Handwritten", className: homemadeApple.className, size: "text-xl" },
] as const;

const pct = (n: number) => `${n}%`;

export default function SignSplitSheetPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const data = useQuery(api.splitSignatures.lookup, token ? { token } : "skip");
  const signMutation = useMutation(api.splitSignatures.sign);

  const [mode, setMode] = React.useState<"typed" | "drawn">("typed");
  // null = untouched; the signer's legal name from the grant is the default,
  // derived rather than synced into state so no effect is needed.
  const [typedNameEdit, setTypedNameEdit] = React.useState<string | null>(null);
  const typedName = typedNameEdit ?? data?.signer.name ?? "";
  const [fontKey, setFontKey] = React.useState<string | null>(null);
  const [drawnDataUrl, setDrawnDataUrl] = React.useState<string | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [signedOk, setSignedOk] = React.useState(false);

  const ready =
    acknowledged &&
    (mode === "typed" ? typedName.trim().length > 0 && fontKey !== null : drawnDataUrl !== null);

  async function handleSign() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signMutation({
        token,
        signature: mode === "typed" ? typedName.trim() : drawnDataUrl!,
        signatureKind: mode,
        signatureFont: mode === "typed" ? fontKey ?? undefined : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setSignedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[380px]"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #fdb9131a, transparent 70%)" }}
      />
      <div className="relative mx-auto w-full max-w-2xl">
        {data === undefined ? (
          <div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-gold" /></div>
        ) : data === null ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <AlertTriangle className="mx-auto size-6 text-critical" />
            <p className="mt-3 font-grotesk text-lg font-semibold text-bone">This signing link is no longer valid</p>
            <p className="mt-1 text-sm text-steel">It may have been replaced by a newer link. Ask the studio to send a fresh one.</p>
          </div>
        ) : signedOk || data.alreadySigned ? (
          <div className="rounded-chrome border border-positive/30 bg-coal/60 p-8 text-center shadow-elev-2">
            <CheckCircle2 className="mx-auto size-6 text-positive" />
            <p className="mt-3 font-grotesk text-lg font-semibold text-bone">Thanks {data.signer.name.split(" ")[0]} - you have signed.</p>
            <p className="mt-1 text-sm text-steel">You can close this tab. The studio has a copy on file.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <header className="rounded-chrome border border-graphite/50 bg-coal/60 p-6 shadow-elev-2">
              <p className="font-meta text-[0.625rem] uppercase tracking-wide text-gold">{data.studioName}</p>
              <h1 className="mt-1 font-grotesk text-2xl font-bold tracking-tight text-bone">Split sheet for review + signature</h1>
              {data.song && (
                <p className="mt-1 text-sm text-steel">{data.song.title}{data.song.artist ? ` - ${data.song.artist}` : ""}</p>
              )}
            </header>

            <section className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 shadow-elev-2">
              <h2 className="font-grotesk text-sm font-semibold text-bone">Contributors and splits</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-graphite/50 text-left text-[0.625rem] uppercase tracking-wide text-steel/70">
                    <th className="py-2 font-meta">Name</th>
                    <th className="py-2 font-meta">Role</th>
                    <th className="py-2 text-right font-meta">Master</th>
                    <th className="py-2 text-right font-meta">Publishing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sheet.contributors.map((c, i) => (
                    <tr key={i} className={`border-b border-graphite/50/60 ${i === data.signer.contributorIndex ? "bg-gold/5" : ""}`}>
                      <td className="py-2 text-bone">{c.name}{i === data.signer.contributorIndex ? " (you)" : ""}</td>
                      <td className="py-2 text-steel">{c.role}</td>
                      <td className="py-2 text-right font-meta text-bone">{pct(c.masterPct)}</td>
                      <td className="py-2 text-right font-meta text-bone">{pct(c.publishingPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 shadow-elev-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" />
                <h2 className="font-grotesk text-sm font-semibold text-bone">Sign</h2>
              </div>
              <p className="mt-1 text-xs text-steel">Sign by choosing a signature style for your legal name, or draw your signature below. The studio captures the time you signed and your browser so the record is auditable.</p>

              {/* Capture-mode toggle */}
              <div className="mt-3 inline-flex items-center gap-1 rounded-md border border-graphite/50 bg-obsidian p-1">
                {(
                  [
                    { key: "typed", label: "Choose a style", icon: Type },
                    { key: "drawn", label: "Draw", icon: PenLine },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
                      mode === key ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>

              {mode === "typed" ? (
                <>
                  <label className="mt-3 block">
                    <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Type your full legal name</span>
                    <input
                      type="text"
                      value={typedName}
                      onChange={(e) => setTypedNameEdit(e.target.value)}
                      className="mt-1 w-full rounded-md border border-graphite/50 bg-obsidian px-3 py-2 text-sm text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
                    />
                  </label>

                  <span className="mt-3 block font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Pick your signature</span>
                  <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SIGNATURE_STYLES.map((style) => (
                      <button
                        key={style.key}
                        type="button"
                        onClick={() => setFontKey(style.key)}
                        className={cn(
                          "flex min-h-20 flex-col items-start justify-between gap-1 rounded-md border bg-white px-4 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
                          fontKey === style.key
                            ? "border-gold ring-2 ring-gold/40"
                            : "border-graphite/50 hover:border-gold/50",
                        )}
                      >
                        <span className={cn("w-full truncate text-neutral-900", style.className, style.size)}>
                          {typedName.trim() || "Your name"}
                        </span>
                        <span className="font-meta text-[0.5625rem] uppercase tracking-wide text-neutral-500">{style.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <SignaturePad className="mt-3" onChange={setDrawnDataUrl} />
              )}

              <label className="mt-4 flex items-start gap-2 text-xs text-steel">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-gold"
                />
                I have reviewed the split percentages and I agree to be bound by them. This electronic signature is legally binding, the same as a handwritten one.
              </label>

              {error && <p className="mt-3 text-sm text-critical">{error}</p>}

              <button
                type="button"
                disabled={busy || !ready}
                onClick={handleSign}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Sign split sheet
              </button>
            </section>

            {!data.whitelabel && (
              <p className="pb-4 text-center text-[0.625rem] text-steel/70">
                Powered by{" "}
                <a
                  href="https://pulse.myindsound.com/?ref=sign"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline-offset-2 transition-colors hover:text-gold-bright hover:underline"
                >
                  Pulse
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Finger/stylus/mouse signature pad. White "paper" canvas, dark ink, sized to
 * its container and scaled for the device pixel ratio so strokes stay crisp.
 * Every completed stroke exports the pad as a PNG data URI via onChange;
 * clearing reports null so the caller can gate the Sign button.
 */
function SignaturePad({
  className,
  onChange,
}: {
  className?: string;
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawingRef = React.useRef(false);
  const [inked, setInked] = React.useState(false);

  const paintBlank = React.useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  // Size the bitmap to the rendered element once on mount. The pad is a
  // fixed-height strip, so a resize mid-signature (rare) just means clearing.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    paintBlank(canvas);
  }, [paintBlank]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot for taps: a zero-length line would render nothing.
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    setInked(true);
    onChange(e.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintBlank(canvas);
    setInked(false);
    onChange(null);
  }

  return (
    <div className={className}>
      <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Draw your signature</span>
      <div className="relative mt-1.5">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="h-44 w-full cursor-crosshair rounded-md border border-graphite/50 bg-white"
          style={{ touchAction: "none" }}
        />
        {!inked && (
          <span className="pointer-events-none absolute inset-x-0 bottom-8 mx-8 border-b border-neutral-300 text-center text-xs text-neutral-400">
            Sign here with your finger or mouse
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={!inked}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-graphite/50 px-3 py-1.5 text-xs font-medium text-steel transition-colors hover:text-bone disabled:opacity-40"
      >
        <Eraser className="size-3.5" />
        Clear
      </button>
    </div>
  );
}
