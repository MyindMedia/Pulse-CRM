"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";

/** Public, token-authed view of one library file. No login. The link expires
 *  (collaboratorGrants) and is revoked from the studio side. */
export default function GuestFilePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const data = useQuery(api.mediaLibrary.guestAsset, token ? { token } : "skip");
  const approve = useMutation(api.mediaLibrary.guestSetApproval);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  async function decide(versionId: Id<"mediaVersions">, state: "approved" | "changes_requested") {
    setError(null);
    try { await approve({ token, versionId, state, note: notes[versionId] || undefined }); }
    catch (err) { setError(errorMessage(err)); }
  }

  return (
    <main className="grain mx-auto min-h-dvh max-w-2xl bg-ink p-6 text-bone">
      {data === undefined ? (
        <p className="text-sm text-steel">Loading</p>
      ) : data === null ? (
        <div className="mt-24 text-center">
          <h1 className="text-xl font-semibold">This link has expired</h1>
          <p className="mt-2 text-sm text-steel">Ask the studio to send you a new one.</p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="mt-1 text-sm text-steel">Shared with {data.guestName}. Link works until {new Date(data.expiresAt).toLocaleString()}.</p>
          {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
          <ul className="mt-6 space-y-4">
            {data.versions.map((v) => (
              <li key={v._id} className="rounded-lg border border-graphite/50 p-4">
                <p className="font-semibold">Version {v.version} <span className="text-xs font-normal text-steel">{v.fileName}</span></p>
                {v.note && <p className="mt-1 text-sm text-steel">{v.note}</p>}
                <p className="mt-1 text-xs text-steel">{v.approval === "approved" ? "Approved" : v.approval === "changes_requested" ? "Changes asked for" : "Waiting for your answer"}</p>
                {v.url && <a className="mt-2 inline-block text-sm text-gold underline" href={v.url} target="_blank" rel="noopener noreferrer">Download</a>}
                {data.canApprove && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="h-9 min-w-0 flex-1 rounded-lg border border-graphite/60 bg-coal-2 px-3 text-sm"
                      placeholder="Comment (optional)"
                      aria-label="Comment"
                      value={notes[v._id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [v._id]: e.target.value }))}
                    />
                    <button type="button" className="h-9 rounded-lg bg-gold px-3 text-sm font-semibold text-gold-ink" onClick={() => decide(v._id, "approved")}>Approve</button>
                    <button type="button" className="h-9 rounded-lg border border-graphite/60 px-3 text-sm" onClick={() => decide(v._id, "changes_requested")}>Ask for changes</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
