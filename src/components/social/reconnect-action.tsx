"use client";

import { RefreshCw } from "lucide-react";
import type { Platform } from "@convex/lib/ghl";
import { Button } from "@/components/ui/button";
import { useConnectFlow } from "./use-connect-flow";

/** One-click fix for an account marked `needs_reconnect`: reopens the same
 *  GHL OAuth popup as ConnectButton, but with `reconnect: true` so
 *  startConnect skips the plan-cap check (the org already owns this slot,
 *  it just needs a fresh token). Once GHL reports back and the picked
 *  page/profile is attached, `insertInternal` finds the existing row by
 *  ghlAccountId and revives it to `connected` - the row updates itself
 *  through the reactive `list` query, no local state to reconcile here. */
export function ReconnectAction({ platform, accountName }: { platform: Platform; accountName: string }) {
  const { busy, options, error, begin, finish } = useConnectFlow(platform, true);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className="border-critical/40 text-critical hover:border-critical hover:bg-critical/10"
        onClick={begin}
        disabled={busy}
        aria-label={`Reconnect ${accountName}`}
      >
        <RefreshCw className={busy ? "size-3.5 animate-spin" : "size-3.5"} />
        {busy ? "Reconnecting…" : "Reconnect"}
      </Button>
      {(options || error) && (
        <div className="absolute right-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-graphite/50 bg-coal-3 p-2 shadow-elev-3">
          {error && <p className="px-1 py-1 text-xs text-critical">{error}</p>}
          {options && (
            <ul className="flex flex-col gap-1">
              {options.list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-bone transition-colors hover:bg-coal-2"
                    onClick={() => void finish(options.ghlAccountId, c)}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
