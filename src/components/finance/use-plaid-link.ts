"use client";

import * as React from "react";

/* Plaid Link, loaded on demand.

   Plaid's own drop-in, from Plaid's CDN, so the bank sign-in happens in Plaid's
   frame and Pulse never sees a bank username or password. Loaded only when
   someone opens it, not on every page. The public token it returns is handed
   straight to banking.exchangePublicToken, which swaps it server-side. */

type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: unknown) => void;
    onExit: (error: { error_message?: string; display_message?: string } | null) => void;
  }) => PlaidHandler;
};

const SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
let loading: Promise<PlaidGlobal> | null = null;

function loadPlaid(): Promise<PlaidGlobal> {
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error("Plaid Link did not load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Plaid Link could not load. Check the connection and try again."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function usePlaidLink(opts: {
  onSuccess: (publicToken: string) => void | Promise<void>;
  onExit?: (message: string | null) => void;
}) {
  const handler = React.useRef<PlaidHandler | null>(null);
  const mounted = React.useRef(false);
  const request = React.useRef(0);
  const optsRef = React.useRef(opts);
  React.useEffect(() => {
    optsRef.current = opts;
  });
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      handler.current?.destroy();
      handler.current = null;
    };
  }, []);

  return React.useCallback(async (token: string) => {
    if (!mounted.current) return;
    const currentRequest = ++request.current;
    const Plaid = await loadPlaid();
    if (!mounted.current || currentRequest !== request.current) return;
    handler.current?.destroy();
    handler.current = Plaid.create({
      token,
      onSuccess: (publicToken) => void optsRef.current.onSuccess(publicToken),
      onExit: (error) => optsRef.current.onExit?.(error ? error.display_message ?? error.error_message ?? "Closed." : null),
    });
    handler.current.open();
  }, []);
}
