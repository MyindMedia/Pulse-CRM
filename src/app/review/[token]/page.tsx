"use client";

import * as React from "react";
import { PublicTheme } from "@/components/shell/public-theme";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { Loader2, Star, CheckCircle2, Disc3 } from "lucide-react";

/**
 * Public post-session review page. The route param is the sessionId (Convex ids
 * are unguessable, so the link itself is the capability). No Clerk login. Mirrors
 * the public booking / portal chrome: dark ink canvas, gold accent.
 */
export default function ReviewPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token ?? "") as Id<"sessions">;

  const info = useQuery(api.reviews.forSession, token ? { sessionId: token } : "skip");
  const submit = useMutation(api.reviews.submit);

  const [rating, setRating] = React.useState(0);
  const [hover, setHover] = React.useState(0);
  const [text, setText] = React.useState("");
  const [authorName, setAuthorName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const alreadyDone = done || (info?.valid && info.alreadyReviewed);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submit({
        sessionId: token,
        rating,
        text: text.trim() || undefined,
        authorName: authorName.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grain relative flex min-h-dvh flex-col bg-ink p-6 text-bone">
      <PublicTheme token={token} />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[380px]"
        style={{ background: "radial-gradient(ellipse 60% 100% at 50% 0%, #fdb9131a, transparent 70%)" }}
      />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center space-y-5 py-10">
        {info === undefined ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="size-6 animate-spin text-gold" />
          </div>
        ) : !info?.valid ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <p className="font-grotesk text-lg font-semibold text-bone">This review link is not valid</p>
            <p className="mt-1 text-sm text-steel">
              The link may have expired. Reach out to the studio if you would still like to leave a review.
            </p>
          </div>
        ) : alreadyDone ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <CheckCircle2 className="mx-auto size-10 text-gold" />
            <p className="mt-3 font-grotesk text-lg font-semibold text-bone">Thank you</p>
            <p className="mt-1 text-sm text-steel">
              Your review helps {info.studioName} and other artists. We appreciate you.
            </p>
          </div>
        ) : !info.completed ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <p className="font-grotesk text-lg font-semibold text-bone">Not quite yet</p>
            <p className="mt-1 text-sm text-steel">
              You can leave a review once your session is complete. Check back after your session at{" "}
              {info.studioName}.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <header className="text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-md bg-gold text-gold-ink shadow-[0_1px_0_0_rgba(255,255,255,.25)_inset]">
                <Disc3 className="size-6" />
              </span>
              <h1 className="mt-4 font-grotesk text-2xl font-bold tracking-tight text-bone">
                How was your session at {info.studioName}?
              </h1>
              <p className="mt-1 text-sm text-steel">
                {info.sessionTitle ? `"${info.sessionTitle}" - ` : ""}A quick rating takes about 20 seconds.
              </p>
            </header>

            <section className="rounded-chrome border border-graphite/50 bg-coal/60 p-6 shadow-elev-2">
              {/* Star rating */}
              <div className="flex items-center justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = (hover || rating) >= n;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} star${n === 1 ? "" : "s"}`}
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(0)}
                      onClick={() => setRating(n)}
                      className="rounded p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                    >
                      <Star
                        className={`size-9 ${active ? "fill-gold text-gold" : "text-steel/40"}`}
                      />
                    </button>
                  );
                })}
              </div>

              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Anything you want to share about your experience? (optional)"
                rows={4}
                maxLength={2000}
                className="mt-5 w-full resize-none rounded-md border border-graphite/50 bg-obsidian px-3 py-2 text-sm text-bone outline-none placeholder:text-steel/70 focus-visible:ring-2 focus-visible:ring-gold/30"
              />

              <input
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="Your name (optional)"
                maxLength={120}
                className="mt-3 w-full rounded-md border border-graphite/50 bg-obsidian px-3 py-2 text-sm text-bone outline-none placeholder:text-steel/70 focus-visible:ring-2 focus-visible:ring-gold/30"
              />

              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={busy || rating < 1}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-gold-ink transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Submit review
              </button>
            </section>

            <p className="text-center text-[0.625rem] text-steel/70">Powered by Pulse</p>
          </form>
        )}
      </div>
    </div>
  );
}
