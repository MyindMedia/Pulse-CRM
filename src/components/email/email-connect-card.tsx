"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Mail, CheckCircle2, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Client-comms email setup. The studio picks a channel: connect Google (send as
 * their real Gmail) or the internal Pulse channel (Resend-backed). Reused in
 * onboarding + settings.
 */
function ChannelOption({
  active,
  title,
  desc,
  onSelect,
}: {
  active: boolean;
  title: string;
  desc: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex-1 rounded-lg border px-4 py-3 text-left transition-colors",
        active ? "border-gold-dim bg-gold/[0.06]" : "border-graphite/60 bg-coal/40 hover:border-graphite/50",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-grotesk text-sm font-semibold text-bone">{title}</span>
        {active && <CheckCircle2 className="size-4 text-gold" />}
      </div>
      <p className="mt-1 text-xs text-steel">{desc}</p>
    </button>
  );
}

export function EmailConnectCard() {
  const status = useQuery(api.clientEmail.emailStatus, {});
  const authUrl = useAction(api.googleAuth.authUrl);
  const disconnect = useMutation(api.googleAuth.disconnect);
  const setProvider = useMutation(api.clientEmail.setProvider);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("google") === "connected") toast.success("Google account connected.");
    if (p.get("google") === "error") toast.error("Couldn’t connect Google. Try again.");
  }, []);

  async function connectGoogle() {
    setBusy(true);
    try {
      const { url } = await authUrl({});
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not start Google connect.");
      setBusy(false);
    }
  }

  async function choose(provider: "internal" | "google") {
    try {
      await setProvider({ provider });
      toast.success(provider === "google" ? "Sending as your Google account." : "Using the internal Pulse channel.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not switch channel.");
    }
  }

  const provider = status?.provider ?? "internal";

  return (
    <div className="rounded-chrome border border-graphite/50 bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <Mail className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-grotesk text-sm font-semibold text-bone">Client email</p>
          <p className="mt-0.5 text-sm text-steel">
            Choose how booking confirmations and client messages are sent.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <ChannelOption
          active={provider === "internal"}
          title="Internal Pulse email"
          desc="Sends from your studio via Pulse. Works out of the box."
          onSelect={() => choose("internal")}
        />
        <ChannelOption
          active={provider === "google"}
          title="Connect Google"
          desc="Send as your real Gmail address for the most personal touch."
          onSelect={() => choose("google")}
        />
      </div>

      {/* Google connection controls */}
      <div className="mt-4 border-t border-graphite/50 pt-4">
        {status === undefined ? (
          <p className="text-xs text-steel/70">Checking…</p>
        ) : status.googleConnected ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-steel">
              Google connected{status.googleEmail ? ` - ${status.googleEmail}` : ""}.
            </p>
            <Button size="sm" variant="ghost" onClick={() => disconnect({})}>
              Disconnect
            </Button>
          </div>
        ) : !status.googleConfigured ? (
          <p className="text-xs text-steel/70">
            Google connect isn’t enabled on this workspace yet - your admin needs to configure it.
          </p>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={connectGoogle}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            Connect Google account
            {!busy && <ArrowUpRight className="size-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}
