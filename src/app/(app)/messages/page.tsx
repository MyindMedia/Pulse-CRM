"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Conversation } from "@convex/messageInbox";
import { toast } from "sonner";
import {
  Search,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Info,
  Phone,
  Mail,
  CalendarPlus,
  ExternalLink,
  MessagesSquare,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/toggle";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ChatThread, ChatComposer } from "@/components/messages/chat";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Messages: every client conversation in one place, laid out like the Zuops
   inbox. The list on the left, the conversation in the middle, the client on
   the right. On a phone it is one column at a time: the list, then the
   conversation with a back button, with the client behind the info button.
   ?client=<artistId> opens a conversation (links from texts, pushes, the
   client page). */

type View = "all" | "unread" | "waiting" | "archived";

const VIEWS: { view: View; label: string }[] = [
  { view: "all", label: "All" },
  { view: "unread", label: "Unread" },
  { view: "waiting", label: "Needs reply" },
  { view: "archived", label: "Archived" },
];

const CHANNEL: Record<string, string> = { google: "Email", internal: "Email", sms: "Text", portal: "Portal" };

function when(at: number) {
  const d = new Date(at);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (Date.now() - at < 6 * 86_400_000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MessagesInbox() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = (params.get("client") as Id<"artists"> | null) ?? null;

  const [view, setView] = React.useState<View>("all");
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [infoOpen, setInfoOpen] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  const rows = useQuery(api.messageInbox.conversations, { view, search: query || undefined });
  const markRead = useMutation(api.messageInbox.markRead);

  // Opening a conversation reads it, and so does a new message arriving while it is open.
  const open = rows?.find((r) => r.artistId === selected);
  const openUnread = open?.unread === true;
  React.useEffect(() => {
    if (selected && (openUnread || !rows)) void markRead({ artistId: selected }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, openUnread]);

  const choose = (id: Id<"artists"> | null) => {
    setInfoOpen(false);
    router.replace(id ? `/messages?client=${id}` : "/messages", { scroll: false });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Messages" description="Texts, emails and portal messages with every client." />
      <div className="relative flex h-[calc(100dvh-10rem)] min-h-[30rem] overflow-hidden rounded-xl border border-graphite/50 bg-ink-2">
        {/* Conversation list */}
        <aside
          className={cn(
            "flex w-full min-w-0 flex-col border-graphite/50 md:w-80 md:shrink-0 md:border-r",
            selected && "hidden md:flex",
          )}
        >
          <div className="space-y-2 border-b border-graphite/50 p-3">
            <label className="flex items-center gap-2 rounded-lg border border-graphite/60 bg-obsidian px-3 py-2 focus-within:border-gold/60">
              <Search className="size-4 shrink-0 text-steel/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients and messages"
                aria-label="Search conversations"
                className="min-w-0 flex-1 bg-transparent text-sm text-bone outline-none placeholder:text-steel/50"
              />
            </label>
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter conversations">
              {VIEWS.map((v) => (
                <button
                  key={v.view}
                  type="button"
                  role="tab"
                  aria-selected={view === v.view}
                  onClick={() => setView(v.view)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    view === v.view ? "bg-gold/15 text-bone" : "text-steel/70 hover:bg-coal-2 hover:text-steel",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows === undefined ? (
              <div className="p-3">
                <SkeletonRows rows={6} />
              </div>
            ) : rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-steel/70">
                {query ? "No conversations match." : view === "all" ? "No client messages yet." : "Nothing here."}
              </p>
            ) : (
              <ul>
                {rows.map((c) => (
                  <ConversationRow key={c.artistId} c={c} active={c.artistId === selected} onOpen={() => choose(c.artistId)} />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Conversation */}
        <section className={cn("flex min-w-0 flex-1 flex-col", !selected && "hidden md:flex")}>
          {selected ? (
            <>
              <ThreadHeader
                artistId={selected}
                conversation={open}
                onBack={() => choose(null)}
                onInfo={() => setInfoOpen((o) => !o)}
                infoOpen={infoOpen}
              />
              <ChatThread artistId={selected} className="flex-1" />
              <ChatComposer artistId={selected} />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-steel/70">
              <MessagesSquare className="size-6" />
              Pick a conversation to read and reply.
            </div>
          )}
        </section>

        {/* Client card: a column on wide screens, a panel over the thread otherwise. */}
        {selected && (
          <aside
            className={cn(
              "min-h-0 w-80 shrink-0 overflow-y-auto border-l border-graphite/50 bg-ink-2",
              infoOpen ? "absolute inset-y-0 right-0 z-20 block w-full max-w-sm shadow-elev-3 xl:static xl:shadow-none" : "hidden xl:block",
            )}
          >
            <ContactCard artistId={selected} onClose={() => setInfoOpen(false)} />
          </aside>
        )}
      </div>
    </div>
  );
}

function ConversationRow({ c, active, onOpen }: { c: Conversation; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-3 border-b border-graphite/30 px-3 py-3 text-left transition-colors",
          active ? "bg-gold/10" : "hover:bg-coal-2/60",
        )}
      >
        <Avatar name={c.name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", c.unread ? "font-semibold text-bone" : "text-bone/90")}>{c.name}</span>
            <span className="shrink-0 text-[0.6875rem] text-steel/60">{when(c.lastAt)}</span>
          </span>
          <span className={cn("mt-0.5 line-clamp-2 text-xs", c.unread ? "text-steel" : "text-steel/70")}>
            {c.lastDirection === "out" && "You: "}
            {c.lastBody}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span className="rounded border border-graphite/60 px-1.5 py-px text-[0.625rem] text-steel/70">{CHANNEL[c.lastChannel] ?? c.lastChannel}</span>
            {c.waiting && <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-gold">Needs reply</span>}
          </span>
        </span>
        {c.unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" aria-label="Unread" />}
      </button>
    </li>
  );
}

function ThreadHeader({
  artistId,
  conversation,
  onBack,
  onInfo,
  infoOpen,
}: {
  artistId: Id<"artists">;
  conversation: Conversation | undefined;
  onBack: () => void;
  onInfo: () => void;
  infoOpen: boolean;
}) {
  const contact = useQuery(api.messageInbox.contact, { artistId });
  const setArchived = useMutation(api.messageInbox.setArchived);
  const archived = conversation?.archived === true;
  const name = contact?.name ?? conversation?.name ?? "";

  async function archive() {
    try {
      await setArchived({ artistId, archived: !archived });
      toast.success(archived ? "Back in the inbox." : "Archived. A new message brings it back.");
      if (!archived) onBack();
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not archive it.");
    }
  }

  return (
    <header className="flex items-center gap-2 border-b border-graphite/50 px-3 py-2.5 sm:px-4">
      <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to conversations" onClick={onBack}>
        <ArrowLeft />
      </Button>
      {name && <Avatar name={name} size="sm" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-bone">{name || "Loading…"}</p>
        <p className="truncate text-[0.6875rem] text-steel/70">{contact?.phone ?? contact?.email ?? ""}</p>
      </div>
      {contact?.phone && (
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Call ${name}`}>
          <a href={`tel:${contact.phone}`}>
            <Phone />
          </a>
        </Button>
      )}
      <Button type="button" variant="ghost" size="icon-sm" aria-label={archived ? "Move back to inbox" : "Archive conversation"} onClick={archive}>
        {archived ? <ArchiveRestore /> : <Archive />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="xl:hidden"
        aria-label="Client details"
        aria-pressed={infoOpen}
        onClick={onInfo}
      >
        <Info />
      </Button>
    </header>
  );
}

function ContactCard({ artistId, onClose }: { artistId: Id<"artists">; onClose: () => void }) {
  const contact = useQuery(api.messageInbox.contact, { artistId });
  const setAiReplies = useMutation(api.messageInbox.setAiReplies);

  if (contact === undefined) {
    return (
      <div className="p-4">
        <SkeletonRows rows={4} />
      </div>
    );
  }
  if (contact === null) return <p className="p-4 text-sm text-steel/70">This client is no longer on your roster.</p>;

  async function toggleAi(on: boolean) {
    try {
      await setAiReplies({ artistId, on });
      toast.success(on ? "The Pulse agent can answer this client again." : "The Pulse agent will leave this client to you.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not change it.");
    }
  }

  const next = contact.next;
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={contact.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-grotesk text-base font-semibold text-bone">{contact.name}</p>
            <Badge tone={contact.status === "vip" ? "positive" : contact.status === "lead" ? "info" : "neutral"} className="mt-1 capitalize">
              {contact.status}
            </Badge>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" className="xl:hidden" aria-label="Close client details" onClick={onClose}>
          <X />
        </Button>
      </div>

      <dl className="space-y-2 text-sm">
        {contact.phone && (
          <div className="flex items-center gap-2 text-steel">
            <Phone className="size-4 shrink-0 text-steel/60" />
            <a href={`tel:${contact.phone}`} className="truncate hover:text-bone">{contact.phone}</a>
          </div>
        )}
        {contact.email && (
          <div className="flex items-center gap-2 text-steel">
            <Mail className="size-4 shrink-0 text-steel/60" />
            <a href={`mailto:${contact.email}`} className="truncate hover:text-bone">{contact.email}</a>
          </div>
        )}
      </dl>

      {contact.receptionistOn && (
        <label className="flex items-center justify-between gap-3 rounded-lg border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <span className="flex items-center gap-2 text-sm text-bone">
            <Sparkles className="size-4 text-gold" /> Pulse agent replies
          </span>
          <Switch checked={!contact.aiRepliesOff} onCheckedChange={toggleAi} aria-label="Let the Pulse agent reply to this client" />
        </label>
      )}

      <div>
        <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-steel/60">Next session</p>
        {next ? (
          <Link href={`/calendar?session=${next.sessionId}`} className="block rounded-lg border border-graphite/50 bg-coal/40 px-3 py-2.5 hover:border-gold-dim/60">
            <p className="text-sm font-medium text-bone">
              {new Date(next.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })},{" "}
              {new Date(next.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="truncate text-xs text-steel/70">{[next.room, next.title].filter(Boolean).join(" · ")}</p>
          </Link>
        ) : (
          <p className="text-sm text-steel/70">Nothing booked.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-graphite/50 bg-coal/40 px-3 py-2.5">
          <p className="text-[0.6875rem] text-steel/60">Sessions</p>
          <p className="font-grotesk text-lg font-semibold text-bone">{contact.sessionCount}</p>
        </div>
        {contact.outstandingCents !== null && (
          <div className="rounded-lg border border-graphite/50 bg-coal/40 px-3 py-2.5">
            <p className="text-[0.6875rem] text-steel/60">Owes</p>
            <p className={cn("font-grotesk text-lg font-semibold", contact.outstandingCents > 0 ? "text-gold" : "text-bone")}>
              {money(contact.outstandingCents)}
            </p>
          </div>
        )}
      </div>

      {contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {contact.tags.map((t) => (
            <Badge key={t} tone="neutral">{t}</Badge>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/calendar?new=1`}>
            <CalendarPlus className="size-3.5" /> Book a session
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/roster/${artistId}`}>
            <ExternalLink className="size-3.5" /> Open client page
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <MessagesInbox />
    </Suspense>
  );
}
