"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

export default function BrandingPage() {
  const update = useMutation(api.branding.updateAgencyBranding);
  const [accent, setAccent] = React.useState("#fdb913");
  const [appName, setAppName] = React.useState("");
  const [customDomain, setCustomDomain] = React.useState("");
  const [msg, setMsg] = React.useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await update({
        accentColor: accent,
        appName: appName || undefined,
        customDomain: customDomain || undefined,
      });
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-bone">Agency branding</h1>
        <p className="text-sm text-ash">
          Logo, accent, and (on Agency tier) your own custom domain.
        </p>
      </header>
      <form
        onSubmit={save}
        className="max-w-lg space-y-4 rounded-lg border border-hairline bg-coal/40 p-4"
      >
        <label className="block space-y-1">
          <span className="text-sm text-bone">Accent color</span>
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="block h-10 w-20 rounded border border-hairline-2 bg-ink-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-bone">App name (shown in nav)</span>
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="Pulse, AcmeOS, …"
            className="w-full rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-bone">Custom domain (Agency tier)</span>
          <input
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="app.acme.com"
            className="w-full rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright"
        >
          Save
        </button>
        {msg && <p className="text-xs text-ash">{msg}</p>}
      </form>
    </div>
  );
}
