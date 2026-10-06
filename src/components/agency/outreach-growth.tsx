"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Copy, ExternalLink, MapPin, MessageCircle, Search, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import type { Id } from "@convex/_generated/dataModel";

/* Outreach growth tools: find studios (Discover) and message them on Instagram
   (DMs). Pulse drafts and records; a person sends every DM from Instagram, so
   nothing here sends anything. Each status carries text, not colour alone. */

type Tone = "neutral" | "positive" | "caution" | "critical" | "info";

const FIELD = "rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone placeholder:text-steel/50";
const when = (ms: number) => new Date(ms).toLocaleString();

function useRun() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const run = React.useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 200) : "Something went wrong.");
    }
  }, []);
  return { msg, err, run, setMsg };
}

function Feedback({ msg, err }: { msg: string | null; err: string | null }) {
  return (
    <>
      {msg && <p role="status" className="text-sm text-positive">{msg}</p>}
      {err && <p role="alert" className="text-sm text-critical">{err}</p>}
    </>
  );
}

function Unauthorized() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Agency membership required"
      description="Outreach is limited to agency members. Sign in with an agency account to see it."
    />
  );
}

/* -------------------------------- Discover -------------------------------- */

const JOB_TONE: Record<string, Tone> = { running: "info", done: "positive", failed: "critical" };

export function Discover() {
  const data = useQuery(api.outreachDiscover.list, {});
  const start = useMutation(api.outreachDiscover.start);
  const { msg, err, run } = useRun();
  const [kind, setKind] = React.useState<"maps" | "instagram">("maps");
  const [query, setQuery] = React.useState("recording studio");
  const [location, setLocation] = React.useState("");

  if (data === undefined) return <LoadingPanel label="Loading discovery" />;
  if (data === null) return <Unauthorized />;
  const manage = data.canManage && data.enabled;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Find studios</CardTitle>
          <CardDescription>
            Google Maps finds studios in a city with the website, email and phone they publish (about a tenth of a cent
            each). Instagram search finds studio accounts by keyword (about a fifth of a cent per search). Results land in
            Prospects. Nothing is emailed or messaged from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div role="radiogroup" aria-label="Where to search" className="flex flex-wrap gap-2">
            {([["maps", "Google Maps", MapPin], ["instagram", "Instagram", Search]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`inline-flex items-center gap-2 rounded border px-3 py-2 text-sm ${kind === k ? "border-gold text-bone" : "border-graphite/60 text-steel"}`}
              >
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="disc-query" className="text-xs text-steel/70">Search for</label>
              <input id="disc-query" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} className={`${FIELD} w-64`} />
            </div>
            {kind === "maps" && (
              <div className="space-y-1">
                <label htmlFor="disc-loc" className="text-xs text-steel/70">City</label>
                <input id="disc-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Los Angeles, CA" maxLength={80} className={`${FIELD} w-56`} />
              </div>
            )}
            <Button
              variant="primary"
              disabled={!manage || query.trim().length < 2 || (kind === "maps" && location.trim().length < 2)}
              onClick={() => void run(async () => {
                await start({ kind, query, location: kind === "maps" ? location : undefined });
              }, "Search started. Results appear below and in Prospects in a few seconds.")}
            >
              Find studios
            </Button>
          </div>
          {!data.enabled && <p className="text-xs text-caution">Discovery is off until TREG_TOKEN is set on this deployment.</p>}
          {data.enabled && !data.canManage && <p className="text-xs text-steel">Only an owner or admin can run discovery.</p>}
          <Feedback msg={msg} err={err} />
        </CardContent>
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState icon={Search} title="No searches yet" description="Search Google Maps for a city, or Instagram for a keyword, to fill your prospect list." />
      ) : (
        <Card>
          <CardHeader><CardTitle>Recent searches</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-graphite/40">
              {data.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="text-bone">{r.kind === "maps" ? "Google Maps" : "Instagram"}: {r.query}{r.location ? ` in ${r.location}` : ""}</p>
                    <p className="text-xs text-steel/70">{when(r.createdAt)}</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <Badge tone={JOB_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                    <p className="text-xs text-steel/70">
                      {r.status === "failed" ? r.error : r.status === "done" ? `${r.added} new, ${r.duplicates} already listed, ${r.found} found` : "Searching"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ----------------------------------- DMs ----------------------------------- */

const DM_TONE: Record<string, Tone> = { draft: "neutral", approved: "info", sent: "positive", cancelled: "caution" };

function DmCard({ d, manage, run }: {
  d: { id: string; handle: string; studio: string; text: string; status: string; expired: boolean; link: string; sentAt: number | null };
  manage: boolean;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const approve = useMutation(api.outreachDms.approve);
  const edit = useMutation(api.outreachDms.edit);
  const cancel = useMutation(api.outreachDms.cancel);
  const markSent = useMutation(api.outreachDms.markSent);
  const optOut = useMutation(api.outreachDms.optOut);
  const [text, setText] = React.useState(d.text);
  const id = d.id as Id<"outreachDms">;
  const status = d.expired ? "approval expired" : d.status;
  const dirty = text.trim() !== d.text;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-grotesk text-sm font-semibold text-bone">{d.studio}</p>
            <p className="text-xs text-steel/70">@{d.handle}{d.sentAt ? ` · sent ${when(d.sentAt)}` : ""}</p>
          </div>
          <Badge tone={d.expired ? "caution" : DM_TONE[d.status] ?? "neutral"}>{status}</Badge>
        </div>
        {(d.status === "draft" || d.status === "approved") ? (
          <>
            <label htmlFor={`dm-${d.id}`} className="sr-only">Message to @{d.handle}</label>
            <textarea id={`dm-${d.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={5} disabled={!manage} className={`${FIELD} w-full`} />
            <p className="text-xs text-steel/70">{text.length} characters. Editing a message clears its approval. No links in a cold DM.</p>
          </>
        ) : (
          <p className="whitespace-pre-wrap rounded border border-graphite/40 bg-coal/40 p-3 text-sm text-bone">{d.text}</p>
        )}
        {manage && (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (d.status === "draft" || d.status === "approved") && (
              <Button variant="secondary" onClick={() => void run(() => edit({ id, text }), "Message updated. Approve it again.")}>Save edit</Button>
            )}
            {d.status === "draft" && !dirty && (
              <Button variant="primary" onClick={() => void run(() => approve({ id }), "Approved for 24 hours. Open Instagram, send it, then mark it sent.")}>Approve</Button>
            )}
            {d.status === "approved" && !d.expired && !dirty && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void run(async () => { await navigator.clipboard.writeText(d.text); }, "Copied. Paste it into the Instagram message.")}
                >
                  <Copy className="size-4" aria-hidden /> Copy message
                </Button>
                <a
                  href={d.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded border border-graphite/60 px-3 py-2 text-sm text-bone"
                >
                  <ExternalLink className="size-4" aria-hidden /> Open in Instagram
                </a>
                <Button variant="primary" onClick={() => void run(() => markSent({ id }), "Recorded as sent.")}>I sent it</Button>
              </>
            )}
            {d.status === "approved" && d.expired && (
              <Button variant="secondary" onClick={() => void run(() => edit({ id, text: d.text }), "Back to draft. Approve it again.")}>Reopen</Button>
            )}
            {(d.status === "draft" || d.status === "approved") && (
              <Button variant="secondary" onClick={() => void run(() => cancel({ id }), "Cancelled.")}>Cancel</Button>
            )}
            {d.status !== "cancelled" && (
              <Button variant="secondary" onClick={() => void run(() => optOut({ id }), "They asked to stop. They will not be messaged again.")}>They said stop</Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Dms() {
  const data = useQuery(api.outreachDms.overview, {});
  const prepare = useMutation(api.outreachDms.prepare);
  const findContact = useMutation(api.outreachDiscover.findInstagramContact);
  const { msg, err, run } = useRun();

  if (data === undefined) return <LoadingPanel label="Loading DMs" />;
  if (data === null) return <Unauthorized />;
  const manage = data.canManage;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Instagram DMs</CardTitle>
          <CardDescription>
            Pulse writes a short, specific opener from what the studio says about itself. You approve each one, send it
            from Instagram yourself, and mark it sent. Instagram does not allow automated cold DMs, and sending through
            a robot risks your account, so there is no auto-send. One DM per studio per 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent><Feedback msg={msg} err={err} /></CardContent>
      </Card>

      {data.dms.length > 0 && (
        <section aria-label="Drafted and sent DMs" className="space-y-3">
          {data.dms.map((d) => <DmCard key={d.id} d={d} manage={manage} run={run} />)}
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Studios with an Instagram handle</CardTitle>
          <CardDescription>Pick one to draft a DM. Find Instagram email reads only what the account itself publishes.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.candidates.length === 0 ? (
            <EmptyState icon={MessageCircle} title="No studios to message yet" description="Run an Instagram search in Discover, or paste handles in Prospects." />
          ) : (
            <ul className="divide-y divide-graphite/40">
              {data.candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <p className="text-bone">{c.name ?? `@${c.handle}`}</p>
                    <p className="text-xs text-steel/70">
                      @{c.handle}{c.category ? ` · ${c.category}` : ""}{c.followers ? ` · ${c.followers.toLocaleString()} followers` : ""}
                      {c.hasEmail ? " · has email" : ""}
                    </p>
                  </div>
                  {manage && (
                    <div className="flex flex-wrap gap-2">
                      {!c.hasEmail && (
                        <Button variant="secondary" onClick={() => void run(() => findContact({ id: c.id as Id<"outreachProspects"> }), "Looking up the email on their profile. Check Prospects in a few seconds.")}>
                          Find Instagram email
                        </Button>
                      )}
                      <Button variant="primary" onClick={() => void run(() => prepare({ prospectId: c.id as Id<"outreachProspects"> }), "Draft ready above. Review it, then approve.")}>
                        Draft DM
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
