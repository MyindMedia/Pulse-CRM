"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Loader2, ShieldCheck, CheckCircle2, AlertTriangle } from "lucide-react";

const pct = (n: number) => `${n}%`;

export default function SignSplitSheetPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const data = useQuery(api.splitSignatures.lookup, token ? { token } : "skip");
  const signMutation = useMutation(api.splitSignatures.sign);

  const [typedName, setTypedName] = React.useState("");
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [signedOk, setSignedOk] = React.useState(false);

  React.useEffect(() => {
    if (data?.signer.name && !typedName) setTypedName(data.signer.name);
  }, [data?.signer.name, typedName]);

  async function handleSign() {
    if (!typedName.trim() || !acknowledged || busy) return;
    setBusy(true);
    try {
      await signMutation({
        token,
        signature: typedName.trim(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setSignedOk(true);
    } catch {
      // Server already returned a sensible error; surface it via toast in a fuller build.
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
      <div className="relative mx-auto w-full max-w-2xl">
        {data === undefined ? (
          <div className="grid place-items-center py-24"><Loader2 className="size-6 animate-spin text-gold" /></div>
        ) : data === null ? (
          <div className="rounded-2xl border border-hairline bg-coal/60 p-8 text-center shadow-elev-2">
            <AlertTriangle className="mx-auto size-6 text-critical" />
            <p className="mt-3 font-display text-lg font-semibold text-bone">This signing link is no longer valid</p>
            <p className="mt-1 text-sm text-ash">It may have already been used or expired. Ask the studio to send a new link.</p>
          </div>
        ) : signedOk || data.alreadySigned ? (
          <div className="rounded-2xl border border-positive/30 bg-coal/60 p-8 text-center shadow-elev-2">
            <CheckCircle2 className="mx-auto size-6 text-positive" />
            <p className="mt-3 font-display text-lg font-semibold text-bone">Thanks {data.signer.name.split(" ")[0]} - you have signed.</p>
            <p className="mt-1 text-sm text-ash">You can close this tab. The studio has a copy on file.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <header className="rounded-2xl border border-hairline bg-coal/60 p-6 shadow-elev-2">
              <p className="font-mono text-[0.625rem] uppercase tracking-wide text-gold">{data.studioName}</p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-bone">Split sheet for review + signature</h1>
              {data.song && (
                <p className="mt-1 text-sm text-ash">{data.song.title}{data.song.artist ? ` - ${data.song.artist}` : ""}</p>
              )}
            </header>

            <section className="rounded-2xl border border-hairline bg-coal/60 p-5 shadow-elev-2">
              <h2 className="font-display text-sm font-semibold text-bone">Contributors and splits</h2>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-[0.625rem] uppercase tracking-wide text-ash-dim">
                    <th className="py-2 font-mono">Name</th>
                    <th className="py-2 font-mono">Role</th>
                    <th className="py-2 text-right font-mono">Master</th>
                    <th className="py-2 text-right font-mono">Publishing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sheet.contributors.map((c, i) => (
                    <tr key={i} className={`border-b border-hairline/60 ${i === data.signer.contributorIndex ? "bg-gold/5" : ""}`}>
                      <td className="py-2 text-bone">{c.name}{i === data.signer.contributorIndex ? " (you)" : ""}</td>
                      <td className="py-2 text-ash">{c.role}</td>
                      <td className="py-2 text-right font-mono text-bone">{pct(c.masterPct)}</td>
                      <td className="py-2 text-right font-mono text-bone">{pct(c.publishingPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-2xl border border-hairline bg-coal/60 p-5 shadow-elev-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-gold" />
                <h2 className="font-display text-sm font-semibold text-bone">Sign</h2>
              </div>
              <p className="mt-1 text-xs text-ash">By typing your full legal name and signing below, you agree to the split percentages above. The studio captures the time you signed and your browser so the record is auditable.</p>

              <label className="mt-3 block">
                <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">Type your full legal name</span>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-hairline bg-ink-2 px-3 py-2 text-sm text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
                />
              </label>

              <label className="mt-3 flex items-start gap-2 text-xs text-ash">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 accent-gold"
                />
                I have reviewed the split percentages and I agree to be bound by them.
              </label>

              <button
                type="button"
                disabled={busy || !typedName.trim() || !acknowledged}
                onClick={handleSign}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-opacity disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                Sign split sheet
              </button>
            </section>

            {!data.whitelabel && (
              <p className="pb-4 text-center text-[0.625rem] text-ash-dim">Powered by Pulse</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
