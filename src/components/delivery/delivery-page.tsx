"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Download, LoaderCircle, Lock } from "lucide-react";
import { FileRow } from "./file-row";
import {
  formatBytes,
  initials,
  inkFor,
  isPlayable,
  safeAccent,
  safeHttpUrl,
  serverMessage,
  usd,
} from "./format";
import { downloadInFrame, isTouchApple } from "./platform";

/* The client's download page, /delivery/<token>. No login: the token in the
   URL is the only credential, so it is never logged, never put in an error
   and never sent to another site (the layout sets no-referrer).

   States, from one live query (it unlocks by itself when the payment lands):
     undefined  loading skeleton
     null       the generic expired page: no studio name, no logo (A-01)
     locked     names and sizes, a lock mark per file, a Pay button
     unlocked   play (audio only), download, Download all

   File bytes never pass through this page or Convex: each click mints one ten
   minute signed R2 link (sessionDelivery.fileUrl). A download loads that link
   in its own hidden frame (the server sends it as an attachment), so the page
   never navigates away and several downloads never cancel each other. Play
   asks for its link with purpose "play", which the server does not count as a
   download.

   Dates come from the server already written out in the studio's time zone
   (booking.dateLabel, expiresLabel), so the page and the email agree.

   Design reference: specs/features/session-file-delivery/mockup.html, view 3. */

type PageData = NonNullable<FunctionReturnType<typeof api.sessionDelivery.page>>;
type VersionId = Id<"mediaVersions">;

/** Download all starts each file in turn, this far apart. */
const DOWNLOAD_GAP_MS = 600;
/** A signed URL lives ten minutes; reuse one for playback only inside nine. */
const URL_REUSE_MS = 9 * 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type LinkCache = Map<string, { url: string; at: number }>;

/** A playback link fetched under nine minutes ago, else null. */
function freshLink(cache: LinkCache, id: string): string | null {
  const hit = cache.get(id);
  return hit && Date.now() - hit.at < URL_REUSE_MS ? hit.url : null;
}

function rememberLink(cache: LinkCache, id: string, url: string): void {
  cache.set(id, { url, at: Date.now() });
}

/** Starts one download in a hidden frame. False when the link is unusable. */
function startDownload(url: string): boolean {
  const safe = safeHttpUrl(url);
  if (!safe) return false;
  downloadInFrame(safe);
  return true;
}

const subscribeNever = () => () => {};
const touchAppleNow = () => isTouchApple(navigator);
const notOnServer = () => false;

/** iPhone or iPad. False on the server and during hydration, so the first
 *  client render matches the server's HTML; React then re-renders with the
 *  real answer. */
function useTouchApple(): boolean {
  return React.useSyncExternalStore(subscribeNever, touchAppleNow, notOnServer);
}

const BIG =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] bg-[var(--studio)] px-5 text-[0.9375rem] font-bold text-[var(--studio-ink)] disabled:cursor-wait @max-[30rem]:w-full";

export function DeliveryPage({ token }: { token: string }) {
  const page = useQuery(api.sessionDelivery.page, token ? { token } : "skip");
  const opened = useMutation(api.sessionDelivery.opened);
  const refresh = useMutation(api.sessionDelivery.refresh);

  // Once each, for the life of the tab: `opened` on the first unlocked render,
  // `refresh` on the first locked one (it releases a delivery whose balance was
  // cleared by a path that missed the payment trigger).
  const openedOnce = React.useRef(false);
  const refreshedOnce = React.useRef(false);
  const state = page ? page.state : null;
  React.useEffect(() => {
    if (!token) return;
    if (state === "unlocked" && !openedOnce.current) {
      openedOnce.current = true;
      opened({ token }).catch(() => {});
    } else if (state === "locked" && !refreshedOnce.current) {
      refreshedOnce.current = true;
      refresh({ token }).catch(() => {});
    }
  }, [state, token, opened, refresh]);

  const accent = safeAccent(page?.studio.accent);
  const style = {
    "--studio": accent,
    "--studio-ink": inkFor(accent),
  } as React.CSSProperties;

  return (
    <main
      style={style}
      className="@container min-h-dvh bg-ink text-[0.9375rem] leading-normal text-bone [-webkit-font-smoothing:antialiased]"
    >
      <div
        className="mx-auto grid max-w-[42.5rem] gap-[1.375rem] pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(1.375rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] @max-[30rem]:pt-[max(1.375rem,env(safe-area-inset-top))] @max-[30rem]:pb-[max(1.125rem,env(safe-area-inset-bottom))] @max-[30rem]:pl-[max(1rem,env(safe-area-inset-left))] @max-[30rem]:pr-[max(1rem,env(safe-area-inset-right))]"
      >
        {!token || page === null ? (
          <Gone />
        ) : page === undefined ? (
          <Skeleton />
        ) : (
          <Delivery page={page} token={token} />
        )}
        <Footer />
      </div>
    </main>
  );
}

/* ── States ─────────────────────────────────────────────────── */

function Gone() {
  return (
    <div className="grid gap-2 px-2 py-14 text-center">
      <h1 className="text-[1.75rem] leading-[1.2] font-bold tracking-[-0.01em] text-balance @max-[30rem]:text-[1.5rem]">
        This link has expired
      </h1>
      <p className="mt-1.5 text-steel">Ask the studio to send a new one. Your files are still safe with them.</p>
    </div>
  );
}

function Skeleton() {
  const bar = "rounded-md bg-coal-2 motion-safe:animate-pulse";
  return (
    <div className="grid gap-[1.375rem]" aria-busy="true">
      <p className="sr-only" role="status">
        Loading your files
      </p>
      <div className="flex items-center gap-2.5" aria-hidden="true">
        <span className={`size-9 ${bar}`} />
        <span className={`h-4 w-32 ${bar}`} />
      </div>
      <div className="grid gap-2" aria-hidden="true">
        <span className={`h-8 w-4/5 ${bar}`} />
        <span className={`h-4 w-1/2 ${bar}`} />
      </div>
      <div className="h-[4.5rem] rounded-lg border border-hairline bg-coal" aria-hidden="true" />
      <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-coal" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3 px-3.5 py-3">
            <span className={`size-9 flex-none ${bar}`} />
            <span className="grid flex-1 gap-1.5">
              <span className={`h-4 w-3/5 ${bar}`} />
              <span className={`h-3 w-1/4 ${bar}`} />
            </span>
            <span className={`size-11 flex-none rounded-full ${bar}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer() {
  const link =
    "inline-flex min-h-11 items-center px-1 text-inherit underline underline-offset-2 hover:text-bone";
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-hairline pt-3.5 text-[0.75rem] text-steel">
      <span>Delivered with Pulse</span>
      <span className="flex items-center">
        <a className={link} href="/privacy">
          Privacy
        </a>
        <span aria-hidden="true" className="px-0.5">
          ·
        </span>
        <a className={link} href="/terms">
          Terms
        </a>
      </span>
    </footer>
  );
}

function Brand({ studio }: { studio: PageData["studio"] }) {
  const logo = safeHttpUrl(studio.logoUrl);
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-[0.9375rem] font-bold">
      {logo ? (
        // A studio's own logo, served from its media store; never optimized
        // through a Pulse route. The name beside it carries the meaning.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          className="h-9 w-auto max-w-32 flex-none rounded-md object-contain object-left"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-9 flex-none place-items-center rounded-md bg-[var(--studio)] text-[0.875rem] font-extrabold text-[var(--studio-ink)]"
        >
          {initials(studio.name)}
        </span>
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">{studio.name}</span>
    </div>
  );
}

function Delivery({ page, token }: { page: PageData; token: string }) {
  const fileUrl = useMutation(api.sessionDelivery.fileUrl);
  const locked = page.state === "locked";
  const files = page.files;
  const first = page.clientFirstName.trim();

  /* ── Downloads ─────────────────────────────────────────── */
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [messages, setMessages] = React.useState<Record<string, string>>({});
  const setMessage = (id: string, msg: string | null) =>
    setMessages((m) => {
      const next = { ...m };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  async function download(versionId: VersionId) {
    setMessage(versionId, null);
    setBusy((b) => ({ ...b, [versionId]: true }));
    try {
      const { url } = await fileUrl({ token, versionId, purpose: "download" });
      if (!startDownload(url)) setMessage(versionId, "That file is not available.");
    } catch (err) {
      setMessage(versionId, serverMessage(err, "That file is not available."));
    } finally {
      setBusy((b) => ({ ...b, [versionId]: false }));
    }
  }

  const [step, setStep] = React.useState<{ at: number; of: number } | null>(null);
  const running = React.useRef(false);
  // iPhone and iPad start one download per tap, so they get a line instead
  // of Download all.
  const touchApple = useTouchApple();

  async function downloadAll() {
    if (running.current) return;
    running.current = true;
    const list = files.map((f) => f.versionId);
    for (const id of list) setMessage(id, null);
    try {
      for (let i = 0; i < list.length; i++) {
        setStep({ at: i + 1, of: list.length });
        try {
          const { url } = await fileUrl({ token, versionId: list[i], purpose: "download" });
          if (!startDownload(url)) setMessage(list[i], "That file is not available.");
        } catch (err) {
          // The reason goes on the row it belongs to.
          const msg = serverMessage(err, "That file is not available.");
          setMessage(list[i], msg);
          // Rate limited: every later call would be refused too.
          if (msg.startsWith("Too many")) break;
        }
        if (i < list.length - 1) await sleep(DOWNLOAD_GAP_MS);
      }
    } finally {
      running.current = false;
      setStep(null);
    }
  }

  /* ── Playback: one native <audio>, one track at a time ──── */
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const urls = React.useRef<LinkCache>(new Map());
  const [current, setCurrent] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);

  async function playNow(a: HTMLAudioElement, id: string) {
    try {
      await a.play();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") return; // another track took over
      // Some browsers (Safari on iPhone) refuse play() once the tap is
      // spent on fetching the link. The link is loaded now; a second tap
      // plays straight away.
      setMessage(id, name === "NotAllowedError" ? "Tap play again to listen." : "This file cannot play here. Download it instead.");
    }
  }

  async function togglePlay(versionId: VersionId) {
    const a = audioRef.current;
    if (!a || loadingId) return;
    setMessage(versionId, null);
    if (current === versionId && !a.paused) {
      a.pause();
      return;
    }
    const fresh = freshLink(urls.current, versionId);
    // Resume or start from a link we already hold: play() inside the tap.
    if (fresh) {
      if (current !== versionId || a.getAttribute("src") !== fresh) {
        a.src = fresh;
        setCurrent(versionId);
        setProgress(0);
      }
      void playNow(a, versionId);
      return;
    }
    setLoadingId(versionId);
    try {
      const { url } = await fileUrl({ token, versionId, purpose: "play" });
      const safe = safeHttpUrl(url);
      if (!safe) throw new Error("unusable link");
      rememberLink(urls.current, versionId, safe);
      a.src = safe;
      setCurrent(versionId);
      setProgress(0);
      await playNow(a, versionId);
    } catch (err) {
      setMessage(versionId, serverMessage(err, "That file is not available."));
    } finally {
      setLoadingId(null);
    }
  }

  function onAudioError() {
    const a = audioRef.current;
    if (!a || !current || !a.getAttribute("src")) return;
    // An expired link or a format this browser cannot decode. Drop the link
    // so the next tap fetches a fresh one.
    urls.current.delete(current);
    a.removeAttribute("src");
    setPlaying(false);
    setMessage(current, "This file cannot play here. Try again or download it.");
  }

  /* ── Copy ──────────────────────────────────────────────── */
  const heading = locked
    ? `Your files are finished${first ? `, ${first}` : ""}`
    : `Your files are ready${first ? `, ${first}` : ""}`;
  const when = [page.booking.title, page.booking.roomName, page.booking.dateLabel]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(" · ");
  const payUrl = safeHttpUrl(page.payUrl);
  const balance = page.balanceCents && page.balanceCents > 0 ? usd(page.balanceCents) : null;
  const count = `${files.length} file${files.length === 1 ? "" : "s"} · ${formatBytes(page.totalBytes)}`;

  return (
    <>
      <Brand studio={page.studio} />

      <div>
        <h1 className="text-[1.75rem] leading-[1.2] font-bold tracking-[-0.01em] text-balance @max-[30rem]:text-[1.5rem]">
          {heading}
        </h1>
        <p className="mt-1.5 text-steel">{when}</p>
      </div>

      {locked ? (
        <section aria-labelledby="lock-title" className="grid gap-3 rounded-lg border border-hairline bg-coal px-4 py-[1.125rem]">
          <span className="inline-flex h-6 items-center gap-1.5 justify-self-start rounded-full border border-hairline bg-coal-2 px-2.5 text-[0.75rem] font-semibold text-gold">
            <Lock className="size-3" strokeWidth={1.75} aria-hidden />
            Balance due
          </span>
          <h2 id="lock-title" className="text-[1.25rem] leading-[1.25] font-bold tracking-normal">
            {balance ? `Pay ${balance} to unlock your files` : "Pay to unlock your files"}
          </h2>
          <p className="text-steel">Downloads open on this page as soon as the payment goes through.</p>
          {payUrl && (
            <a href={payUrl} className={`${BIG} justify-self-start`}>
              Pay and unlock
            </a>
          )}
        </section>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-coal px-4 py-3.5">
          <div>
            <p className="font-bold">{count}</p>
            <p className="font-mono text-[0.75rem] tracking-[0.01em] text-steel">
              Link works until {page.expiresLabel}
            </p>
          </div>
          {touchApple ? (
            <p className="text-[0.8125rem] text-steel">Tap a file to download it.</p>
          ) : (
            <div className="grid gap-1.5 @max-[30rem]:w-full">
              <button type="button" className={BIG} onClick={downloadAll} disabled={step !== null}>
                {step ? (
                  <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Download className="size-4" strokeWidth={1.75} aria-hidden />
                )}
                {step ? `Starting ${step.at} of ${step.of}` : "Download all"}
              </button>
              <p className="sr-only" role="status" aria-live="polite">
                {step ? `Starting ${step.at} of ${step.of}` : ""}
              </p>
            </div>
          )}
        </div>
      )}

      <ul
        aria-label={locked ? "Your files, locked until paid" : "Your files"}
        className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-coal"
      >
        {files.map((f) => (
          <FileRow
            key={f.versionId}
            file={f}
            locked={locked}
            playing={current === f.versionId && playing}
            progress={current === f.versionId ? progress : null}
            playBusy={loadingId === f.versionId}
            downloadBusy={!!busy[f.versionId]}
            message={messages[f.versionId] ?? null}
            onPlay={() => void togglePlay(f.versionId)}
            onDownload={() => void download(f.versionId)}
          />
        ))}
      </ul>

      {!locked && files.some((f) => isPlayable(f.mimeType)) && (
        <audio
          ref={audioRef}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const a = e.currentTarget;
            if (a.duration > 0 && Number.isFinite(a.duration)) setProgress(a.currentTime / a.duration);
          }}
          onError={onAudioError}
        />
      )}
    </>
  );
}
