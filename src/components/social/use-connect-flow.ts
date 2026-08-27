"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Platform } from "@convex/lib/ghl";
import { errorMessage } from "@/lib/errors";
import { PLATFORM_META } from "./platforms";
import { isOwnGhlCloseMessage } from "./ghl-message";

type Choice = { id: string; name: string; type?: string; avatar?: string };

/**
 * The GHL OAuth-popup flow, shared by ConnectButton (add a brand-new account)
 * and ReconnectAction (repair one already marked `needs_reconnect`).
 *
 * Opens the popup, listens for GHL's close postMessage, resolves the
 * page/profile choices, and attaches the picked one. `reconnect` is threaded
 * straight through to startConnect -> startOAuth: true skips the plan-cap
 * check (the org already owns this slot) and reuses the same GHL flow to
 * refresh an existing token; false is a brand-new connection gated by the
 * plan's social_accounts cap.
 */
export function useConnectFlow(platform: Platform, reconnect: boolean) {
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
      // Origin first: the popup we opened, and anything it navigates to,
      // holds window.opener and can post a forged close message otherwise.
      if (!isOwnGhlCloseMessage(e.origin, e.data, platform)) return;
      popup.current?.close();
      popup.current = null;
      handling.current = true;
      const accountId = e.data.accountId;
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

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await start({ platform, reconnect });
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
  }, [start, platform, reconnect]);

  return { meta, busy, options, error, begin, finish };
}
