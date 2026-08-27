"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Platform } from "@convex/lib/ghl";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { PLATFORM_META } from "./platforms";

type Choice = { id: string; name: string; type?: string };

/** Opens GHL's OAuth page in a popup and listens for its postMessage
 *  ({ actionType: "close", page: "social-media-posting", platform, accountId }),
 *  then lets the owner pick which page or profile to attach.
 *
 *  listOAuthAccounts (convex/lib/ghl.ts) returns an empty array rather than
 *  throwing when GHL errors, so an empty picker here is not proof the account
 *  has nothing to offer - it is at least as likely the connection broke. The
 *  empty-list branch below says so instead of rendering a silent blank list. */
export function ConnectButton({ platform, disabled }: { platform: Platform; disabled?: boolean }) {
  const start = useAction(api.marketing.accounts.startConnect);
  const choices = useAction(api.marketing.accounts.choices);
  const attach = useAction(api.marketing.accounts.attach);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<{ ghlAccountId: string; list: Choice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  // True once GHL's postMessage has been received and we are working the
  // response (choices/attach). The popup-closed watcher below must not fire
  // during that window - we already closed the popup ourselves, and the
  // in-flight request, not the popup, now owns the busy state.
  const handling = useRef(false);
  const meta = PLATFORM_META[platform];

  // If the owner closes the popup without finishing (or GHL never posts back
  // a message), the button must not stay stuck in a busy spinner forever.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (!handling.current && popup.current?.closed) {
        popup.current = null;
        setBusy(false);
      }
    }, 500);
    return () => clearInterval(t);
  }, [busy]);

  const finish = useCallback(
    async (ghlAccountId: string, choice: Choice) => {
      setBusy(true);
      try {
        await attach({ platform, ghlAccountId, choice });
        setOptions(null);
        setError(null);
      } catch (err) {
        setError(errorMessage(err, "Could not attach that account. Try again."));
      } finally {
        setBusy(false);
      }
    },
    [attach, platform],
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { actionType?: string; page?: string; platform?: string; accountId?: string } | undefined;
      if (!d || d.actionType !== "close" || d.page !== "social-media-posting" || !d.accountId) return;
      if (d.platform && d.platform !== platform) return;
      popup.current?.close();
      popup.current = null;
      handling.current = true;
      const accountId = d.accountId;
      void (async () => {
        setBusy(true);
        try {
          const list = await choices({ platform, ghlAccountId: accountId });
          if (list.length === 0) {
            setError(`Could not find any ${meta.label} pages or profiles on that account. Reconnect and try again.`);
            setBusy(false);
          } else if (list.length === 1) {
            await finish(accountId, list[0]);
          } else {
            setOptions({ ghlAccountId: accountId, list });
            setBusy(false);
          }
        } catch (err) {
          setError(errorMessage(err, "Could not read the connected account."));
          setBusy(false);
        } finally {
          handling.current = false;
        }
      })();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [platform, choices, meta.label, finish]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const r = await start({ platform });
      if ("simulated" in r) {
        setError("Social publishing is not configured on this server yet.");
        setBusy(false);
        return;
      }
      popup.current = window.open(r.url, "pulse-connect", "width=640,height=760");
      if (!popup.current) {
        setError("Your browser blocked the popup. Allow popups for Pulse and try again.");
        setBusy(false);
      }
    } catch (err) {
      setError(errorMessage(err, "Could not start the connection."));
      setBusy(false);
    }
  }

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
