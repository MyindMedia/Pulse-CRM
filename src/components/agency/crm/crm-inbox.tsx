"use client";

import * as React from "react";
import {
  AlertTriangle, Archive, Bot, CalendarClock, CirclePause, Inbox, Mail, Search, Sparkles, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/field";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StageBadge, SyncBar, TOUCH, ZuErrorState, dateTime, relTime } from "./crm-ui";
import { useZuFetch, useZuRead } from "./use-zu";
import { LeadSheet } from "./crm-lead-sheet";
import { INBOX_OP } from "./inbox-ops";
import { InboxThread, SLOW_POLL_MS } from "./inbox-thread";
import {
  INBOX_FILTERS, channelWord, conversationName, conversationsQuery, filterCount, mergeConversations, previewText,
  type InboxFilter,
} from "./inbox-logic";
import type {
  Conversation, ConversationsResponse, ReplySuggestion, ScheduledMessage, ScheduledResponse, SuggestionsResponse,
} from "./inbox-types";

/* Inbox: filters on the left, conversations in the middle, the thread on the
   right (the Email tab's three panes). On a phone the filters become a row, the
   list fills the screen, and a conversation opens full width with Back. */

const FILTER_ICON: Record<InboxFilter, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  inbox: Inbox,
  unread: Mail,
  unassigned: UserX,
  scheduled: CalendarClock,
  suggested: Sparkles,
  archived: Archive,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type MorePages = { sig: string; items: Conversation[]; cursor: string | null; loading: boolean; error: string | null };

export function CrmInbox({ openLeadId, openNonce }: { openLeadId?: string | null; openNonce?: number }) {
  const [filter, setFilter] = React.useState<InboxFilter>("inbox");
  const [searchText, setSearchText] = React.useState("");
  const search = useDebounced(searchText, 300);
  const [selected, setSelected] = React.useState<string | null>(openLeadId ?? null);
  // Every jump from elsewhere bumps the nonce, so opening the same lead twice
  // (after Back) opens it again (F-U15).
  const jump = `${openLeadId ?? ""}|${openNonce ?? 0}`;
  const [seenJump, setSeenJump] = React.useState(jump);
  if (jump !== seenJump) {
    setSeenJump(jump);
    if (openLeadId) setSelected(openLeadId);
  }
  const [sheetLead, setSheetLead] = React.useState<string | null>(null);

  const listFilter: InboxFilter = filter === "scheduled" || filter === "suggested" ? "inbox" : filter;
  const query = conversationsQuery(listFilter, search);
  const sig = JSON.stringify(query);
  const convs = useZuRead<ConversationsResponse>(INBOX_OP.conversations, { query }, { kinds: ["message"], keepPrevious: true, pollMs: SLOW_POLL_MS });
  // Not on the "message" signal: they refresh on a slow poll and after this
  // panel's own writes (F-U3).
  const scheduled = useZuRead<ScheduledResponse>(INBOX_OP.scheduled, { query: { limit: 100 } }, { pollMs: SLOW_POLL_MS });
  const suggestions = useZuRead<SuggestionsResponse>(INBOX_OP.suggestions, { query: { limit: 100 } }, { pollMs: SLOW_POLL_MS });

  // Which filter the rows on screen belong to. While another filter loads, its
  // label must not sit over the old filter's rows (F-U17); a new search under
  // the same filter keeps the rows, dimmed.
  const [shownFor, setShownFor] = React.useState<InboxFilter>(listFilter);
  if (convs.data && !convs.refreshing && shownFor !== listFilter) setShownFor(listFilter);
  const otherFilter = shownFor !== listFilter;

  const fetchZu = useZuFetch();
  const [more, setMore] = React.useState<MorePages | null>(null);
  const extra = more && more.sig === sig ? more : null;
  const firstItems = otherFilter ? [] : convs.data?.conversations ?? [];
  const list = mergeConversations(firstItems, extra?.items ?? []);
  const nextCursor = otherFilter ? null : extra ? extra.cursor : convs.data?.has_more ? convs.data?.next_cursor ?? null : null;

  const loadMore = async () => {
    if (!nextCursor) return;
    setMore({ sig, items: extra?.items ?? [], cursor: nextCursor, loading: true, error: null });
    const res = await fetchZu<ConversationsResponse>(INBOX_OP.conversations, { query: conversationsQuery(listFilter, search, nextCursor) });
    setMore((m) => {
      const items = m && m.sig === sig ? m.items : [];
      if (res.error || !res.data) return { sig, items, cursor: nextCursor, loading: false, error: res.error?.reason ?? "Could not load more." };
      return {
        sig,
        items: [...items, ...(res.data.conversations ?? [])],
        cursor: res.data.has_more ? res.data.next_cursor ?? null : null,
        loading: false,
        error: null,
      };
    });
  };

  const scheduledList = scheduled.data?.scheduled_messages ?? [];
  const suggestionList = suggestions.data?.suggestions ?? [];
  const counts = convs.data?.counts;
  const countOf = (f: InboxFilter) => filterCount(
    f, counts,
    scheduled.data ? { n: scheduledList.length, more: !!scheduled.data.has_more } : null,
    suggestions.data ? { n: suggestionList.length, more: !!suggestions.data.has_more } : null,
  );
  const selectedConv = selected ? list.find((c) => c.lead_id === selected) : undefined;

  const refreshAll = () => { convs.refresh(); scheduled.refresh(); suggestions.refresh(); };

  return (
    <div className="space-y-4">
      <SyncBar fetchedAt={convs.fetchedAt} onRefresh={refreshAll} refreshing={convs.refreshing} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[11rem_minmax(0,20rem)_minmax(0,1fr)]">
        <nav aria-label="Inbox filters" className={cn("min-w-0", selected && "max-lg:hidden")}>
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {INBOX_FILTERS.map(({ id, label }) => {
              const Icon = FILTER_ICON[id];
              const n = countOf(id);
              const on = filter === id;
              return (
                <li key={id} className="shrink-0">
                  <button
                    type="button" aria-pressed={on}
                    onClick={() => setFilter(id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11",
                      on ? "bg-coal-2 font-semibold text-bone" : "text-steel hover:bg-coal-2/60 hover:text-bone",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    <span className="whitespace-nowrap">{label}</span>
                    {n !== null && <span className="ml-auto pl-2 text-[0.6875rem] tabular-nums text-steel" aria-label={`${n} ${label.toLowerCase()}`}>{n}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-label="Conversations" className={cn("min-w-0 space-y-2", selected && "max-lg:hidden")}>
          {filter === "scheduled" ? (
            <ScheduledList read={scheduled} items={scheduledList} onOpen={setSelected} selected={selected} />
          ) : filter === "suggested" ? (
            <SuggestedList read={suggestions} items={suggestionList} onOpen={setSelected} selected={selected} />
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="crm-inbox-search">Search conversations</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
                  <Input
                    id="crm-inbox-search" type="search" className={cn("pl-9", TOUCH)} value={searchText}
                    placeholder="Name, email or phone" maxLength={80} onChange={(e) => setSearchText(e.target.value)}
                  />
                </div>
                {searchText.trim().length === 1 && <p className="text-[0.6875rem] text-steel/70">Type at least 2 characters to search.</p>}
              </div>
              {convs.error && !convs.data ? (
                <ZuErrorState error={convs.error} onRetry={convs.refresh} />
              ) : convs.loading || otherFilter ? (
                <div aria-busy="true" aria-label="Loading conversations"><SkeletonRows rows={6} /></div>
              ) : list.length === 0 ? (
                <EmptyState
                  icon={filter === "archived" ? Archive : Inbox}
                  title={search.trim().length >= 2 ? "No conversations match" : filter === "archived" ? "Nothing archived" : filter === "unread" ? "All caught up" : "No conversations yet"}
                  description={search.trim().length >= 2 ? "Try another name, email or phone." : "Texts, emails, DMs and calls with leads show up here."}
                />
              ) : (
                <>
                  {convs.error && (
                    <p role="alert" className="flex items-center gap-2 text-xs text-caution"><AlertTriangle className="size-3.5" aria-hidden />Showing the last copy. {convs.error.reason}</p>
                  )}
                  <ul aria-busy={convs.refreshing || undefined} className={cn("divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40 transition-opacity", convs.refreshing && "opacity-60")}>
                    {list.map((c) => <ConversationRow key={c.lead_id} c={c} on={c.lead_id === selected} onOpen={() => setSelected(c.lead_id)} />)}
                  </ul>
                  {extra?.error && <p role="alert" className="text-xs text-critical">{extra.error}</p>}
                  {nextCursor && (
                    <Button type="button" variant="secondary" size="sm" className={cn("w-full", TOUCH)} onClick={loadMore} disabled={extra?.loading}>
                      {extra?.loading ? "Loading" : "Load more"}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <section aria-label="Conversation" className={cn("min-w-0", !selected && "max-lg:hidden")}>
          {selected ? (
            <InboxThread
              key={selected}
              leadId={selected}
              conversation={selectedConv}
              suggestions={suggestionList}
              onBack={() => setSelected(null)}
              onOpenLead={setSheetLead}
            />
          ) : (
            <div className="hidden h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-graphite/50 text-sm text-steel/70 lg:flex">
              Pick a conversation
            </div>
          )}
        </section>
      </div>

      <LeadSheet leadId={sheetLead} onClose={() => setSheetLead(null)} onOpenInbox={(id) => setSelected(id)} />
    </div>
  );
}

function ConversationRow({ c, on, onOpen }: { c: Conversation; on: boolean; onOpen: () => void }) {
  const unread = !!c.unread;
  const name = conversationName(c);
  const when = c.last_message?.created_at ?? c.last_activity_at;
  return (
    <li>
      <button
        type="button" onClick={onOpen} aria-current={on || undefined}
        className={cn(
          "block w-full space-y-1 px-3 py-2.5 text-left outline-none transition-colors hover:bg-coal-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/40",
          on && "bg-coal-2",
        )}
      >
        <span className="flex items-baseline gap-2">
          {unread && <span className="size-2 shrink-0 self-center rounded-full bg-gold" aria-hidden />}
          <span className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-bone" : "text-ash")}>
            {name}{unread && <span className="sr-only"> (unread{c.unread_count ? `, ${c.unread_count}` : ""})</span>}
          </span>
          <span className="shrink-0 text-[0.6875rem] tabular-nums text-steel/70">{relTime(when)}</span>
        </span>
        <span className={cn("block truncate text-sm", unread ? "text-bone" : "text-steel")}>{previewText(c)}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-steel">
          <span>{channelWord(c.channel ?? c.last_message?.channel)}</span>
          {unread && <span className="font-semibold text-gold-bright">Unread</span>}
          <StageBadge stage={c.stage_key ?? c.status ?? null} />
          {c.ai?.paused && <span className="inline-flex items-center gap-1 text-caution"><CirclePause className="size-3" aria-hidden />AI paused</span>}
          {c.ai?.handoff_question && <span className="inline-flex items-center gap-1 text-caution"><Bot className="size-3" aria-hidden />Needs you</span>}
        </span>
      </button>
    </li>
  );
}

type ListRead = { error: { reason: string; code?: string; status: number } | null; loading: boolean; refresh: () => void };

function ScheduledList({
  read, items, onOpen, selected,
}: {
  read: ListRead;
  items: ScheduledMessage[];
  onOpen: (leadId: string) => void;
  selected: string | null;
}) {
  if (read.error && !items.length) return <ZuErrorState error={read.error} onRetry={read.refresh} />;
  if (read.loading) return <div aria-busy="true" aria-label="Loading scheduled messages"><SkeletonRows rows={4} /></div>;
  if (!items.length) {
    return <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Use Schedule in a conversation to send a text or email later." />;
  }
  return (
    <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40" aria-label="Upcoming scheduled messages">
      {items.map((m) => {
        const leadId = m.lead_id ?? m.lead?.id ?? null;
        const name = m.lead?.full_name || m.lead?.email || m.lead?.phone || "Unnamed lead";
        return (
          <li key={m.id}>
            <button
              type="button" disabled={!leadId} onClick={() => leadId && onOpen(leadId)} aria-current={leadId === selected || undefined}
              className={cn("block w-full space-y-1 px-3 py-2.5 text-left outline-none hover:bg-coal-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/40", leadId === selected && "bg-coal-2")}
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-bone">{name}</span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-steel">{dateTime(m.scheduled_at)}</span>
              </span>
              <span className="block truncate text-sm text-steel">{m.body}</span>
              <span className="flex gap-2 text-[0.6875rem] text-steel">
                <span>{channelWord(m.channel)}</span>
                <span className={m.status === "failed" ? "font-semibold text-critical" : undefined}>
                  {m.status === "failed" ? "Failed" : m.status === "sending" ? "Sending" : "Scheduled"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SuggestedList({
  read, items, onOpen, selected,
}: {
  read: ListRead;
  items: ReplySuggestion[];
  onOpen: (leadId: string) => void;
  selected: string | null;
}) {
  const pending = items.filter((s) => (s.status ?? "pending") === "pending");
  if (read.error && !items.length) return <ZuErrorState error={read.error} onRetry={read.refresh} />;
  if (read.loading) return <div aria-busy="true" aria-label="Loading suggested replies"><SkeletonRows rows={4} /></div>;
  if (!pending.length) {
    return <EmptyState icon={Sparkles} title="No suggested replies" description="When the AI is set to suggest instead of send, its drafts wait here for you." />;
  }
  return (
    <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40" aria-label="AI suggested replies">
      {pending.map((s) => {
        const leadId = s.lead_id ?? s.lead?.id ?? null;
        const name = s.lead?.full_name || s.lead?.email || s.lead?.phone || "Unnamed lead";
        return (
          <li key={s.id}>
            <button
              type="button" disabled={!leadId} onClick={() => leadId && onOpen(leadId)} aria-current={leadId === selected || undefined}
              className={cn("block w-full space-y-1 px-3 py-2.5 text-left outline-none hover:bg-coal-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/40", leadId === selected && "bg-coal-2")}
            >
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-bone">{name}</span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-steel">{relTime(s.created_at)}</span>
              </span>
              <span className="block truncate text-sm text-steel">{s.body}</span>
              <span className="flex items-center gap-1 text-[0.6875rem] text-info"><Sparkles className="size-3" aria-hidden />AI suggested · {channelWord(s.channel)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
