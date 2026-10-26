"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle } from "lucide-react";
import { PublicTheme } from "@/components/shell/public-theme";
import { PulseLoader } from "@/components/brand/pulse-loader";
import { amount, amounts, period } from "@/components/royalties/format";

/*
 * Public royalty statement (/royalty/<token>, token-authed, no login). A
 * contributor sees their own shares at one studio across every statement:
 * song, share, amount, paid or owed. Never the sheet or anyone else's rows.
 */

export default function RoyaltyStatementPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const data = useQuery(api.royaltyStatements.view, token ? { token } : "skip");

  const groups = React.useMemo(() => {
    if (!data) return [];
    const by = new Map<string, typeof data.shares>();
    for (const s of data.shares) {
      const key = period(s.periodStart, s.periodEnd);
      by.set(key, [...(by.get(key) ?? []), s]);
    }
    return [...by.entries()];
  }, [data]);

  const totals = React.useMemo(() => {
    const owed: Record<string, number> = {};
    const paid: Record<string, number> = {};
    for (const s of data?.shares ?? []) {
      const into = s.paidAt ? paid : owed;
      into[s.currency] = (into[s.currency] ?? 0) + s.amountCents;
    }
    const list = (m: Record<string, number>) =>
      Object.entries(m).map(([currency, cents]) => ({ currency, cents }));
    return { owed: list(owed), paid: list(paid) };
  }, [data]);

  return (
    <div className="min-h-dvh bg-ink px-4 py-6 sm:p-6">
      <PublicTheme token={token} />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[380px]"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 0%, #fdb9131a, transparent 70%)",
        }}
      />
      <div className="relative mx-auto w-full max-w-2xl">
        {data === undefined ? (
          <PulseLoader variant="compact" message="Loading" />
        ) : data === null ? (
          <div className="rounded-chrome border border-graphite/50 bg-coal/60 p-8 text-center shadow-elev-2">
            <AlertTriangle className="mx-auto size-6 text-critical" />
            <h1 className="mt-3 font-grotesk text-lg font-semibold text-bone">
              This statement link is no longer valid
            </h1>
            <p className="mt-1 text-sm text-steel">
              It may have expired or been replaced. Ask the studio to send a
              fresh one.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <header className="rounded-chrome border border-graphite/50 bg-coal/60 p-6 shadow-elev-2">
              <p className="font-meta text-[0.625rem] uppercase tracking-wide text-gold">
                {data.studioName}
              </p>
              <h1 className="mt-1 font-grotesk text-2xl font-bold tracking-tight text-bone">
                Royalty statement for {data.name}
              </h1>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-steel">Owed to you</dt>
                  <dd className="font-meta text-lg text-bone">
                    {amounts(totals.owed)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-steel">Paid so far</dt>
                  <dd className="font-meta text-lg text-bone">
                    {amounts(totals.paid)}
                  </dd>
                </div>
              </dl>
            </header>

            {groups.length === 0 ? (
              <p className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 text-sm text-steel">
                No shares yet.
              </p>
            ) : (
              groups.map(([label, rows]) => (
                <section
                  key={label}
                  className="rounded-chrome border border-graphite/50 bg-coal/60 p-5 shadow-elev-2"
                >
                  <h2 className="font-grotesk text-sm font-semibold text-bone">
                    {label}
                  </h2>
                  <ul className="mt-2 divide-y divide-graphite/40">
                    {rows.map((r, i) => (
                      <li
                        key={i}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-mist">
                          {r.songTitle}
                        </span>
                        <span className="font-meta text-xs text-steel">
                          {r.pct}%
                        </span>
                        <span className="w-24 text-right font-meta text-bone">
                          {amount(r.amountCents, r.currency)}
                        </span>
                        <span
                          className={
                            r.paidAt
                              ? "text-xs text-positive"
                              : "text-xs text-steel"
                          }
                        >
                          {r.paidAt
                            ? `Paid ${new Date(r.paidAt).toLocaleDateString()}`
                            : "Owed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}

            <p className="px-1 text-xs text-steel">
              Shares follow the split sheets you signed. Payment comes from{" "}
              {data.studioName} directly. This link is private to you and works
              until {new Date(data.expiresAt).toLocaleDateString()}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
