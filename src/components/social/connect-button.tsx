"use client";

import type { Platform } from "@convex/lib/ghl";
import { Button } from "@/components/ui/button";
import { useConnectFlow } from "./use-connect-flow";

/** Opens GHL's OAuth page in a popup and listens for its postMessage
 *  ({ actionType: "close", page: "social-media-posting", platform, accountId }),
 *  then lets the owner pick which page or profile to attach.
 *
 *  `choices` (convex/marketing/accounts.ts) throws GHL_UNAVAILABLE when GHL
 *  cannot be reached rather than returning an empty array, so an empty
 *  picker here is a genuine "nothing on this platform," not a swallowed
 *  failure - a real GHL error surfaces as the `error` state below instead.
 *
 *  Popup/message/attach plumbing lives in useConnectFlow, shared with
 *  ReconnectAction (account-row.tsx) which drives the same flow with
 *  `reconnect: true` for an account already marked `needs_reconnect`. */
export function ConnectButton({ platform, disabled }: { platform: Platform; disabled?: boolean }) {
  const { meta, busy, options, error, begin, finish } = useConnectFlow(platform, false);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-graphite/50 bg-coal-2 p-3">
      <Button onClick={begin} disabled={disabled || busy} variant="secondary">
        <meta.icon className="size-4" /> Connect {meta.label}
      </Button>
      <p className="text-xs text-steel/70">{meta.hint}</p>
      {options && (
        <ul className="flex flex-col gap-1 rounded-lg border border-graphite/50 bg-coal-3 p-2">
          {options.list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-bone transition-colors hover:bg-coal-2"
                onClick={() => void finish(options.ghlAccountId, c)}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  );
}
