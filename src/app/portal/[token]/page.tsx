"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { Loader2, Music2, CalendarCheck, Receipt, Sparkles, SendHorizontal } from "lucide-react";

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (ts: number) => new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ClientPortalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const data = useQuery(api.portal.summary, token ? { token } : "skip");
  const ask = useAction(api.portal.ask);

  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await ask({ token, question: question.trim() });
      setAnswer(res.answer);
    } catch (err) {
      setAnswer(errorMessage(err, "Something went wrong. Please try again or reach out to the studio."));
    } finally {
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
      <div className="relative mx-auto w-full max-w-2xl space-y-5">
        {data === undefined ? (
          <div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-gold" /></div>
        ) : data === null ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <p className="font-grotesk text-lg font-semibold text-bone">This link is no longer valid</p>
            <p className="mt-1 text-sm text-steel">Your portal link may have expired. Ask the studio for a fresh one.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="rounded-chrome border border-graphite/50 bg-coal/60 p-6 shadow-elev-2">
              <p className="font-meta text-[0.625rem] uppercase tracking-wide text-gold">{data.studioName}</p>
              <h1 className="mt-1 font-grotesk text-2xl font-bold tracking-tight text-bone">Hi {data.artistName.split(" ")[0]}</h1>
              <p className="mt-1 text-sm text-steel">Everything we are working on together, in one place.</p>
              {data.outstandingCents > 0 && (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-graphite/50 bg-obsidian px-3 py-1.5 text-sm text-bone">
                  <Receipt className="size-4 text-gold" /> Balance due: <b>{usd(data.outstandingCents)}</b>
                </p>
              )}
            </header>

            {/* Concierge */}
            <section className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 shadow-elev-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-gold" />
                <h2 className="font-grotesk text-sm font-semibold text-bone">Ask the concierge</h2>
              </div>
              <p className="mt-1 text-xs text-steel">When is my mix ready? What do I owe? When is my next session?</p>
              <form onSubmit={handleAsk} className="mt-3 flex gap-2">
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a question..."
                  className="flex-1 rounded-md border border-graphite/50 bg-obsidian px-3 py-2 text-sm text-bone outline-none placeholder:text-steel/70 focus-visible:ring-2 focus-visible:ring-gold/30"
                />
                <button
                  type="submit"
                  disabled={busy || !question.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                </button>
              </form>
              {answer && (
                <p className="mt-3 rounded-md border border-graphite/50 bg-obsidian p-3 text-sm leading-relaxed text-bone">{answer}</p>
              )}
            </section>

            {/* Songs */}
            <PortalList
              icon={<Music2 className="size-4 text-steel/70" />}
              title="Your songs"
              empty="No songs yet."
              items={data.songs.map((s) => ({ key: s.title, primary: s.title, secondary: s.stage }))}
            />

            {/* Sessions */}
            <PortalList
              icon={<CalendarCheck className="size-4 text-steel/70" />}
              title="Upcoming sessions"
              empty="No sessions booked."
              items={data.upcomingSessions.map((s) => ({ key: s.title + s.startTime, primary: s.title, secondary: when(s.startTime) }))}
            />

            {/* Invoices */}
            <PortalList
              icon={<Receipt className="size-4 text-steel/70" />}
              title="Invoices"
              empty="No invoices."
              items={data.invoices.map((i) => ({ key: i.number, primary: i.number, secondary: i.status, trailing: usd(i.amountCents) }))}
            />

            {!data.whitelabel && (
              <p className="pb-4 text-center text-[0.625rem] text-steel/70">Powered by Pulse</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PortalList({
  icon, title, empty, items,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  items: { key: string; primary: string; secondary?: string; trailing?: string }[];
}) {
  return (
    <section className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 shadow-elev-2">
      <div className="flex items-center gap-2">{icon}<h2 className="font-grotesk text-sm font-semibold text-bone">{title}</h2></div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-steel/70">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {items.map((it) => (
            <li key={it.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="min-w-0">
                <span className="block truncate text-sm text-bone">{it.primary}</span>
                {it.secondary && <span className="block truncate font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">{it.secondary}</span>}
              </span>
              {it.trailing && <span className="shrink-0 font-meta text-sm tabular-nums text-bone">{it.trailing}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
