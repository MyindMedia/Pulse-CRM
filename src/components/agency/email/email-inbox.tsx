"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AlertCircle, Archive, Inbox01, Mail01 } from "@untitledui/icons";
import { cn } from "@/lib/utils";
import { LoadingPanel } from "@/components/ui/feedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComposeDialog, NewInboxDialog } from "./email-dialogs";
import { ThreadView } from "./thread-view";

type Box = Id<"mailboxes"> | "unrouted";

function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Count({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-gold/15 px-1.5 text-[0.6875rem] font-semibold tabular-nums text-gold-bright">{n}</span>;
}

export function EmailInbox() {
  const access = useQuery(api.mail.access, {});
  const data = useQuery(api.mail.listMailboxes, access?.allowed ? {} : "skip");
  const ensureDefaults = useMutation(api.mail.ensureDefaults);
  const [box, setBox] = React.useState<Box | null>(null);
  const [archived, setArchived] = React.useState(false);
  const [threadId, setThreadId] = React.useState<Id<"mailThreads"> | null>(null);
  const seeded = React.useRef(false);

  // First open: create Support, Lawrence B and Info if they are missing.
  const count = data?.mailboxes.length;
  React.useEffect(() => {
    if (count === undefined || seeded.current || count >= 3) return;
    seeded.current = true;
    ensureDefaults({}).catch(() => undefined);
  }, [count, ensureDefaults]);

  const mailboxes = React.useMemo(() => (data?.mailboxes ?? []).filter((m) => m.active), [data]);
  const current: Box | null = box ?? mailboxes[0]?._id ?? null;
  const threads = useQuery(api.mail.listThreads, current ? { box: current, archived } : "skip");

  if (access === undefined) return <LoadingPanel label="Checking email access" />;
  if (!access.allowed) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-graphite/50 bg-coal/40 p-4 text-sm text-steel">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
        <p>
          {access.reason === "not_setup"
            ? "Email is not set up on this deployment yet. Set MAIL_AGENCY_ID in the Convex environment (see docs/EMAIL-INBOXES.md)."
            : `Email is limited to owners and admins of the agency that owns ${access.domain}.`}
        </p>
      </div>
    );
  }
  if (data === undefined) return <LoadingPanel label="Loading inboxes" />;
  if (data === null) return null;

  const pick = (b: Box) => { setBox(b); setThreadId(null); };
  const label = (b: Box | null) => (b === "unrouted" ? "Unrouted" : mailboxes.find((m) => m._id === b)?.displayName ?? "Inbox");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ComposeDialog
          mailboxes={mailboxes}
          defaultMailboxId={current && current !== "unrouted" ? current : undefined}
          onSent={(tid, mid) => { setBox(mid); setArchived(false); setThreadId(tid); }}
        />
        <NewInboxDialog onCreated={(id) => pick(id)} />
      </div>

      {/* Phone: the mailbox rail collapses into one select. */}
      <div className="lg:hidden">
        <Select value={current ?? undefined} onValueChange={(v) => pick(v as Box)}>
          <SelectTrigger aria-label="Inbox"><SelectValue placeholder="Choose an inbox" /></SelectTrigger>
          <SelectContent>
            {mailboxes.map((m) => (
              <SelectItem key={m._id} value={m._id}>{m.displayName}{m.unread ? ` (${m.unread})` : ""}</SelectItem>
            ))}
            <SelectItem value="unrouted">Unrouted{data.unroutedUnread ? ` (${data.unroutedUnread})` : ""}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,20rem)_minmax(0,1fr)]">
        <nav aria-label="Inboxes" className="hidden space-y-1 lg:block">
          {mailboxes.map((m) => (
            <button
              key={m._id} type="button" onClick={() => pick(m._id)} title={m.address}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                current === m._id ? "bg-coal-2 text-bone" : "text-steel hover:bg-coal-2/60 hover:text-bone",
              )}
            >
              <Mail01 className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{m.displayName}</span>
              <Count n={m.unread} />
            </button>
          ))}
          <button
            type="button" onClick={() => pick("unrouted")}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
              current === "unrouted" ? "bg-coal-2 text-bone" : "text-steel hover:bg-coal-2/60 hover:text-bone",
            )}
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            <span>Unrouted</span>
            <Count n={data.unroutedUnread} />
          </button>
        </nav>

        <section aria-label={`${label(current)} conversations`} className={cn("min-w-0 space-y-2", threadId && "hidden lg:block")}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-meta text-xs uppercase tracking-wide text-steel/80">{label(current)}{archived ? " · archived" : ""}</h2>
            <button type="button" onClick={() => { setArchived((a) => !a); setThreadId(null); }} className="inline-flex items-center gap-1 text-xs text-steel hover:text-bone">
              {archived ? <><Inbox01 className="size-3.5" aria-hidden /> Inbox</> : <><Archive className="size-3.5" aria-hidden /> Archived</>}
            </button>
          </div>
          {threads === undefined ? (
            <p className="text-sm text-steel/70">Loading</p>
          ) : threads === null || threads.length === 0 ? (
            <div className="rounded-lg border border-graphite/50 bg-coal/40 px-4 py-6 text-sm text-steel/70">
              {current === "unrouted"
                ? "Nothing unrouted. Mail to an address with no inbox shows up here."
                : archived ? "No archived conversations." : "No mail yet."}
            </div>
          ) : (
            <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40">
              {threads.map((t) => (
                <li key={t._id}>
                  <button
                    type="button" onClick={() => setThreadId(t._id)}
                    className={cn("block w-full space-y-0.5 px-3 py-2.5 text-left transition-colors hover:bg-coal-2/60", threadId === t._id && "bg-coal-2")}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className={cn("min-w-0 flex-1 truncate text-sm", t.unreadCount ? "font-semibold text-bone" : "text-ash")}>{t.lastFrom}</span>
                      <span className="shrink-0 text-[0.6875rem] tabular-nums text-steel/70">{when(t.lastMessageAt)}</span>
                    </span>
                    <span className={cn("block truncate text-sm", t.unreadCount ? "text-bone" : "text-steel")}>
                      {t.subject}{t.messageCount > 1 ? ` (${t.messageCount})` : ""}
                    </span>
                    <span className="block truncate text-xs text-steel/70">{t.lastSnippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Conversation" className={cn("min-w-0", !threadId && "hidden lg:block")}>
          {threadId ? (
            <ThreadView
              key={threadId} threadId={threadId} mailboxes={mailboxes} onBack={() => setThreadId(null)}
              onMoved={(mid) => { setBox(mid); }}
            />
          ) : (
            <div className="hidden h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-graphite/50 text-sm text-steel/70 lg:flex">
              Pick a conversation
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
