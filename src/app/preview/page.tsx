"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { KeyRound, Lock, ShieldCheck, PenLine, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* The early-access preview.

   Three states: code, agreement, content. The content is fetched from the
   server only once the code has signed, so nothing unreleased is sitting in
   the page source waiting for a devtools panel. */

export default function PreviewPage() {
  return (
    <Suspense fallback={null}>
      <PreviewGate />
    </Suspense>
  );
}

function PreviewGate() {
  const params = useSearchParams();
  const fromLink = params.get("code") ?? "";
  const [code, setCode] = React.useState(fromLink);
  const [submitted, setSubmitted] = React.useState(fromLink);

  const check = useQuery(api.betaAccess.check, submitted ? { code: submitted } : "skip");
  const recordView = useMutation(api.betaAccess.recordView);

  // Attribution, not authorization: the agency wants to know who opened it,
  // and whether the magic link did the work or they typed the code.
  const viewed = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (check?.valid && submitted && viewed.current !== submitted) {
      viewed.current = submitted;
      void recordView({ code: submitted, viaLink: Boolean(fromLink) }).catch(() => {});
    }
  }, [check?.valid, submitted, recordView, fromLink]);

  if (!submitted || (check && !check.valid)) {
    return (
      <Shell>
        <CodeForm
          code={code}
          setCode={setCode}
          onSubmit={() => setSubmitted(code.trim())}
          error={
            check && !check.valid
              ? check.reason === "revoked"
                ? "That access code has been withdrawn. Get in touch if you think that is wrong."
                : check.reason === "expired"
                  ? "That access code has expired. Ask for a fresh one."
                  : "We do not recognize that code. Check it against your invite."
              : null
          }
        />
      </Shell>
    );
  }

  if (!check) {
    return (
      <Shell>
        <p className="text-sm text-steel">Checking your code…</p>
      </Shell>
    );
  }

  if (!check.signed) {
    return (
      <Shell wide>
        <Agreement code={submitted} recipientName={check.recipientName} company={check.company} />
      </Shell>
    );
  }

  return <PreviewContent code={submitted} claimed={Boolean(check.claimed)} claimedSlug={check.claimedSlug ?? null} />;
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-dvh bg-ink px-5 py-14">
      <div className={wide ? "mx-auto w-full max-w-2xl" : "mx-auto w-full max-w-md"}>
        <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-gold">Pulse</p>
        <p className="mt-1 font-meta text-[0.6875rem] uppercase tracking-[0.12em] text-steel/70">
          Early access preview
        </p>
        <div className="mt-7">{children}</div>
      </div>
    </main>
  );
}

function CodeForm({
  code, setCode, onSubmit, error,
}: {
  code: string;
  setCode: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className="rounded-xl border border-graphite/50 bg-coal-2 p-6"
    >
      <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold">
        <KeyRound className="size-5" />
      </span>
      <h1 className="mt-4 font-grotesk text-xl font-bold tracking-tight text-bone">
        Enter your access code
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-steel">
        Pulse is not public yet. Your code came in your invite email, and it is yours alone.
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="XXXXX-XXXXX"
        autoComplete="off"
        aria-label="Access code"
        className="mt-5 w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-3 text-center font-mono text-lg tracking-[0.2em] text-bone outline-none placeholder:text-steel/40 focus:border-gold"
      />
      {error && (
        <p className="mt-2 text-xs text-critical" role="alert">{error}</p>
      )}
      <Button type="submit" className="mt-4 w-full" disabled={code.trim().length < 4}>
        Continue
      </Button>
      <p className="mt-4 text-[0.7rem] leading-relaxed text-steel/60">
        Do not have a code? Pulse is in a closed preview with a small group of studios.
      </p>
    </form>
  );
}

function Agreement({
  code, recipientName, company,
}: {
  code: string;
  recipientName: string | null;
  company: string | null;
}) {
  const terms = useQuery(api.betaAccess.terms);
  const sign = useMutation(api.betaAccess.sign);
  const [name, setName] = React.useState(recipientName ?? "");
  const [title, setTitle] = React.useState("");
  const [org, setOrg] = React.useState(company ?? "");
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  if (!terms) return <p className="text-sm text-steel">Loading the agreement…</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sign({
        code,
        signedName: name,
        signedTitle: title || undefined,
        signedCompany: org || undefined,
        termsHash: terms!.hash,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
    } catch (e2) {
      const d = (e2 as { data?: { message?: string } })?.data;
      setError(d?.message ?? "That did not go through. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-graphite/50 bg-coal-2 p-6 sm:p-7">
      <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold">
        <Lock className="size-5" />
      </span>
      <h1 className="mt-4 font-grotesk text-xl font-bold tracking-tight text-bone">
        {terms.title}
      </h1>
      <p className="mt-1 font-mono text-[0.7rem] text-steel/60">Version {terms.version}</p>
      <p className="mt-3 text-sm leading-relaxed text-steel">{terms.intro}</p>

      <div className="mt-5 max-h-80 space-y-4 overflow-y-auto rounded-lg border border-graphite/50 bg-coal/40 p-4">
        {terms.clauses.map((c) => (
          <div key={c.heading}>
            <p className="font-grotesk text-[0.8rem] font-semibold text-bone">{c.heading}</p>
            <p className="mt-1 text-xs leading-relaxed text-steel/85">{c.body}</p>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
              Type your full name to sign
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              autoComplete="name"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-2.5 font-[cursive] text-lg text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Owner"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
          <label className="block">
            <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">Studio</span>
            <input
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              placeholder="Your studio"
              className="mt-1 w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">Dated</span>
          <span className="font-mono text-xs text-bone">{today}</span>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-steel">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 accent-gold"
          />
          <span>
            I have read the agreement above and I am signing it on behalf of myself and my
            organization. I understand typing my name counts as my signature.
          </span>
        </label>

        {error && <p className="text-xs text-critical" role="alert">{error}</p>}

        <Button type="submit" className="w-full" disabled={!agreed || name.trim().length < 2 || busy}>
          <PenLine className="mr-1.5 size-4" />
          {busy ? "Signing…" : "Sign and open the preview"}
        </Button>
      </form>
    </div>
  );
}

function PreviewContent({
  code, claimed, claimedSlug,
}: {
  code: string;
  claimed: boolean;
  claimedSlug: string | null;
}) {
  const data = useQuery(api.betaAccess.preview, { code });

  if (!data) {
    return <Shell><p className="text-sm text-steel">Opening…</p></Shell>;
  }
  if (!data.unlocked) {
    return <Shell><p className="text-sm text-steel">That code is no longer open.</p></Shell>;
  }

  return (
    <main className="min-h-dvh bg-ink px-5 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-4xl">
        <header>
          <p className="font-meta text-[0.6875rem] uppercase tracking-[0.18em] text-gold">Pulse</p>
          <h1 className="mt-3 font-grotesk text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            Everything Pulse does, and what it does next
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">
            {data.counts.modules} modules across {data.counts.areas} areas.{" "}
            {data.counts.roadmap > 0
              ? `${data.counts.roadmap} more ${data.counts.roadmap === 1 ? "move is" : "moves are"} still on the board, and you are seeing those too.`
              : "Everything on the roadmap when this list was written has since shipped."}{" "}
            Confidential, under the agreement you signed.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2 rounded-md border border-gold/25 bg-gold/8 px-3 py-2">
            <ShieldCheck className="size-3.5 shrink-0 text-gold" />
            <span className="text-[0.7rem] text-steel">
              Opened by <span className="text-bone">{data.watermark}</span>
              {data.signedAt && ` · signed ${new Date(data.signedAt).toLocaleDateString()}`}
            </span>
          </div>
        </header>

        <div className="mt-8 grid gap-2 sm:grid-cols-3">
          {data.tiers.map((t) => (
            <div key={t.key} className="rounded-lg border border-graphite/50 bg-coal-2 p-4">
              <p className="font-grotesk text-sm font-semibold text-bone">{t.label}</p>
              <p className="mt-0.5 font-mono text-lg tabular-nums text-gold">{t.price}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-steel">{t.pitch}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-8">
          {data.areas.map((area) => (
            <section key={area.area}>
              <div className="flex items-baseline justify-between gap-3 border-b-2 border-gold/70 pb-1.5">
                <h2 className="font-grotesk text-lg font-bold tracking-tight text-bone">{area.label}</h2>
                <span className="font-mono text-[0.65rem] tabular-nums text-steel/60">
                  {area.modules.length + area.alwaysOn.length}
                </span>
              </div>
              <ul className="mt-2">
                {area.modules.map((m) => (
                  <li
                    key={m.key}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-graphite/40 py-2 last:border-0"
                  >
                    <span className="w-full text-sm font-medium text-bone sm:w-48">{m.label}</span>
                    <span className="min-w-0 flex-1 text-xs text-steel/80">{m.blurb}</span>
                    {m.tierLabel && <Badge tone="gold">{m.tierLabel}</Badge>}
                  </li>
                ))}
                {area.alwaysOn.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-graphite/40 py-2 last:border-0"
                  >
                    <span className="w-full text-sm font-medium text-steel sm:w-48">{a.label}</span>
                    <span className="min-w-0 flex-1 text-xs text-steel/70">{a.blurb}</span>
                    <Badge tone="neutral">Always on</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {data.roadmap.length > 0 && (
          <section className="mt-12 rounded-xl border border-info/25 bg-info/8 p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-info" />
              <h2 className="font-grotesk text-lg font-bold tracking-tight text-bone">
                Not built yet
              </h2>
            </div>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-steel">
              Where this is going. Shown to you because you are early, and because your reaction
              to it is the most useful thing you can send back.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {data.roadmap.map((r) => (
                <div key={r.id} className="rounded-lg border border-graphite/50 bg-coal-2 p-4">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-info">
                    {r.kindLabel}
                  </p>
                  <p className="mt-1.5 font-grotesk text-sm font-semibold text-bone">{r.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-steel/85">{r.body}</p>
                  <p className="mt-2 border-t border-graphite/40 pt-2 text-xs leading-relaxed text-steel">
                    <span className="text-info">Why: </span>
                    {r.why}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.shippedFromRoadmap.length > 0 && (
          <section className="mt-8">
            <h2 className="font-grotesk text-lg font-bold tracking-tight text-bone">
              Shipped since this list was written
            </h2>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-steel">
              These were the open questions on the roadmap. They are in the product now.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {data.shippedFromRoadmap.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-positive/30 bg-positive/10 px-2.5 py-1 text-xs text-positive"
                >
                  {r.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The end of the funnel: they have read it, signed it and seen it. */}
        <section className="mt-12 rounded-xl border border-gold/30 bg-gold/8 p-6">
          <h2 className="font-grotesk text-lg font-bold tracking-tight text-bone">
            {claimed ? "Your studio is live" : "Want it?"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-steel">
            {claimed
              ? `You built your studio at /${claimedSlug}. Pick up where you left off.`
              : "Your early-access place is held. Name your studio, pick your booking address, and it is live in about a minute."}
          </p>
          <a
            href={claimed ? `/book/${claimedSlug}` : `/preview/claim?code=${encodeURIComponent(code)}`}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 font-grotesk text-sm font-bold text-gold-ink transition-opacity hover:opacity-90"
          >
            {claimed ? "Open my booking page" : "Build my studio"}
            <ArrowRight className="size-4" />
          </a>
        </section>

        <footer className="mt-12 border-t border-graphite/50 pt-5 text-xs text-steel/60">
          Confidential. Pulse by Myind Sound · studiopulse.tech
        </footer>
      </div>
    </main>
  );
}
