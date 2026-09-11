"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";

/** Texts to the shared number from a client of more than one of this agency's
 *  studios, where Pulse could not tell which studio they meant. A person sends
 *  each one on, so no studio reads a text that was not for them. */
export default function UnroutedTextsPage() {
  const rows = useQuery(api.messages.listUnrouted, {});
  const assign = useMutation(api.messages.assignUnrouted);
  const dismiss = useMutation(api.messages.dismissUnrouted);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(key: string, work: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await work();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err, "That did not go through. Try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="chrome-display text-2xl leading-[0.95] text-bone">Unrouted texts</h1>
        <p className="max-w-2xl text-sm text-steel">
          Replies from a client of more than one of your studios, where it was not clear which studio they meant.
          Send each to the right studio. Texts left here are deleted after 30 days.
        </p>
      </header>

      {rows === undefined ? (
        <p className="text-sm text-steel/70">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-graphite/50 bg-coal/40 px-4 py-6 text-sm text-steel/70">
          Nothing to route. Texts land here only when a client of several studios replies and no studio texted them lately.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r._id} className="space-y-3 rounded-lg border border-graphite/50 bg-coal/40 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-meta text-xs uppercase tracking-wide text-steel/70">
                  Phone ending {r.phoneEnding}
                </p>
                <p className="text-xs tabular-nums text-steel/70">{new Date(r.receivedAt).toLocaleString()}</p>
              </div>
              <p className="whitespace-pre-wrap text-sm text-bone">{r.body}</p>
              <div className="flex flex-wrap gap-2">
                {r.candidates.map((c) => (
                  <button
                    key={c.orgId}
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`${r._id}:${c.orgId}`, () => assign({ id: r._id as Id<"unroutedMessages">, orgId: c.orgId }), `Sent to ${c.studioName}.`)
                    }
                    className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Send to {c.studioName}
                    {c.clientName && <span className="font-normal"> ({c.clientName})</span>}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(`${r._id}:dismiss`, () => dismiss({ id: r._id as Id<"unroutedMessages"> }), "Dismissed.")}
                  className="rounded-md border border-graphite/60 px-3 py-1.5 text-xs text-steel transition-colors hover:text-bone disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
