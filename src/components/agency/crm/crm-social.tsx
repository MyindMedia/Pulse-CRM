"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Bot, Camera, ChevronLeft, ChevronRight, CircleCheck, CircleSlash, Inbox, MessageCircle, MessagesSquare,
  Search, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { useCrmNav } from "./crm-context";
import { ConfirmDialog, SyncBar, TOUCH, WriteButton, ZuErrorState, confirmCopy, relTime, type ConfirmGrant } from "./crm-ui";
import { useIdemFor, useZuRead, useZuWrite, type ZuError } from "./use-zu";
import { SOCIAL_OP } from "./social-ops";
import {
  COMMENTS_PAGE, EMPTY_COMMENT_FILTERS, LEAD_MODES, SOCIAL_OFF_REASON, commentsQuery, connectionStatus, dmStatus, isNotEnabled,
  mergeDms, moveCountText, platformWord,
  type CommentFilters, type LeadMode, type MessagesResponse, type MoveDmLeadsResponse, type SocialAccount,
  type SocialAccountsResponse, type SocialCommentsResponse, type SocialSettings,
} from "./social-logic";

/* Social: the Instagram and Messenger side of Zuops. Connected accounts, who
   becomes a lead, tidying DM people out of Leads, the comment-to-DM feed and
   recent DMs. Connecting accounts happens in the Zuops app. When the feature is
   off for the account, the panel says so instead of erroring. */

type Section = "accounts" | "comments" | "dms";

const PLATFORM_ICON = (p: string | null | undefined) => (p === "instagram" ? Camera : MessagesSquare);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SocialOffState() {
  return <EmptyState icon={CircleSlash} title="Instagram and Messenger is off" description={SOCIAL_OFF_REASON} />;
}

function errorView(error: ZuError, retry: () => void) {
  return isNotEnabled(error) ? <SocialOffState /> : <ZuErrorState error={error} onRetry={retry} />;
}

export function CrmSocial() {
  const [section, setSection] = React.useState<Section>("accounts");
  const accounts = useZuRead<SocialAccountsResponse>(SOCIAL_OP.accounts, undefined, { kinds: ["message"], pollMs: 120_000 });
  const off = isNotEnabled(accounts.error);
  const list = accounts.data?.accounts ?? [];

  return (
    <div className="space-y-4">
      <SyncBar fetchedAt={accounts.fetchedAt} onRefresh={accounts.refresh} refreshing={accounts.refreshing} />
      {off ? <SocialOffState /> : (
        <>
          <div role="group" aria-label="Social sections" className="flex flex-wrap gap-1">
            {([["accounts", "Accounts and leads"], ["comments", "Comments"], ["dms", "DMs"]] as const).map(([id, label]) => (
              <Button key={id} type="button" size="sm" variant={section === id ? "primary" : "secondary"} className={TOUCH} aria-pressed={section === id} onClick={() => setSection(id)}>
                {label}
              </Button>
            ))}
          </div>
          {section === "accounts" && (
            <div className="space-y-8">
              <AccountsSection accounts={list} error={accounts.error} loading={accounts.loading} onRetry={accounts.refresh} />
              <LeadModeSection />
            </div>
          )}
          {section === "comments" && <CommentsSection accounts={list} />}
          {section === "dms" && <DmsSection />}
        </>
      )}
    </div>
  );
}

function AccountsSection({ accounts, error, loading, onRetry }: { accounts: SocialAccount[]; error: ZuError | null; loading: boolean; onRetry: () => void }) {
  return (
    <section aria-labelledby="soc-acc-h" className="space-y-3">
      <h2 id="soc-acc-h" className="font-grotesk text-base font-semibold text-bone">Connected accounts</h2>
      <p className="text-xs text-steel">Connecting, reconnecting and switching accounts happens in the Zuops app, under Settings, Instagram &amp; Messenger.</p>
      {error && !accounts.length ? errorView(error, onRetry)
        : loading ? <Skeleton className="h-24 w-full" />
          : accounts.length === 0 ? <EmptyState icon={Camera} title="No accounts connected" description="Connect an Instagram account or Facebook Page in the Zuops app." />
            : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {accounts.map((a) => {
                  const Icon = PLATFORM_ICON(a.platform);
                  const st = connectionStatus(a);
                  return (
                    <li key={a.id} className="space-y-2 rounded-lg border border-graphite/50 bg-coal/40 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon className="size-4 text-steel" aria-hidden />
                        <p className="min-w-0 flex-1 truncate font-semibold text-bone">{a.name || a.username || a.page_name || "Account"}</p>
                        <Badge tone={st.tone}>{st.ok ? <CircleCheck className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}{st.word}</Badge>
                      </div>
                      <p className="text-steel">{platformWord(a.platform)}{a.page_name && a.page_name !== a.name ? ` · ${a.page_name}` : ""}</p>
                      <ul className="space-y-1 text-steel">
                        <li className="flex items-center gap-1.5"><Inbox className="size-3.5" aria-hidden />{a.enabled ? "DMs come into the Inbox" : "DMs do not come into the Inbox (comment rules still run)"}</li>
                        <li className="flex items-center gap-1.5"><Bot className="size-3.5" aria-hidden />{a.ai_replies ? "The AI answers DMs" : "The AI does not answer DMs"}</li>
                        <li>{a.live ? "Live: replies can go out through it" : "Not live: replies cannot go out through it"}</li>
                        {a.last_event_at && <li>Last activity {relTime(a.last_event_at)}</li>}
                      </ul>
                      {a.last_error && <p role="status" className="text-xs text-critical">Last error: {a.last_error}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
    </section>
  );
}

function LeadModeSection() {
  const settings = useZuRead<SocialSettings>(SOCIAL_OP.settings, undefined, { pollMs: 300_000 });
  const { run, pending } = useZuWrite();
  const [choice, setChoice] = React.useState<LeadMode | null>(null);
  const [count, setCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const current = (settings.data?.lead_mode === "everyone" ? "everyone" : "qualified") as LeadMode;
  const picked = choice ?? current;
  // Bumped after each accepted write: a retry reuses its key, the next action
  // gets a new one (F-U9).
  const [round, setRound] = React.useState(0);
  const keys = {
    save: useIdemFor(`social-mode:${round}:${picked}`),
    count: useIdemFor(`social-move-count:${round}`),
    move: useIdemFor(`social-move-apply:${round}:${count ?? ""}`),
  };

  const save = async (grant?: ConfirmGrant) => {
    setError(null);
    const res = await run(SOCIAL_OP.settingsUpdate, { body: { lead_mode: picked }, idem: keys.save, ...grant }, { invalidate: [SOCIAL_OP.settings] });
    if (res.ok) {
      toast.success(picked === "everyone" ? "Every new DM person now becomes a lead." : "Only qualified DM people become leads now.");
      setChoice(null);
      setRound((r) => r + 1);
    } else setError(res.reason ?? "Zuops refused.");
  };

  const countThem = async () => {
    setError(null);
    const res = await run(SOCIAL_OP.moveDmLeads, { body: { apply: false }, idem: keys.count });
    if (!res.ok) { setError(res.reason ?? "Zuops could not count them."); return; }
    const d = res.data as MoveDmLeadsResponse | undefined;
    setCount(typeof d?.would_move === "number" ? d.would_move : typeof d?.moved === "number" ? d.moved : 0);
  };

  const moveThem = async (grant: ConfirmGrant) => {
    setError(null);
    const res = await run(SOCIAL_OP.moveDmLeads, { body: { apply: true }, idem: keys.move, ...grant }, { invalidate: [SOCIAL_OP.settings, "list_leads"] });
    if (!res.ok) { setError(res.reason ?? "Zuops did not move them."); return; }
    const moved = (res.data as MoveDmLeadsResponse | undefined)?.moved;
    toast.success(`${typeof moved === "number" ? moved : count} moved back to Messages. Nothing was sent to them.`);
    setCount(null);
    setRound((r) => r + 1);
  };

  if (settings.error && !settings.data) return <section aria-label="Who becomes a lead">{errorView(settings.error, settings.refresh)}</section>;
  if (settings.loading) return <Skeleton className="h-40 w-full" />;

  return (
    <section aria-labelledby="soc-mode-h" className="space-y-4">
      <h2 id="soc-mode-h" className="font-grotesk text-base font-semibold text-bone">Who becomes a lead</h2>
      <fieldset className="space-y-2">
        <legend className="sr-only">Who goes into Leads from Instagram and Messenger</legend>
        {LEAD_MODES.map((m) => (
          <label key={m.id} htmlFor={`soc-mode-${m.id}`} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", picked === m.id ? "border-gold-dim bg-gold/5" : "border-graphite/50")}>
            <input
              id={`soc-mode-${m.id}`} type="radio" name="soc-lead-mode" value={m.id} checked={picked === m.id}
              onChange={() => setChoice(m.id)} className="mt-1 size-4 accent-[var(--color-gold,#d4a72c)] focus-visible:outline-2 focus-visible:outline-gold"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-semibold text-bone">{m.label}{m.id === current ? " · current" : ""}</span>
              <span className="block text-xs text-steel">{m.explain}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {picked !== current && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {picked === "everyone" && <p className="mr-auto text-xs text-caution">From now on each new DM person starts your new-lead automations. It applies to people who write from now on.</p>}
          <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => setChoice(null)}>Keep current</Button>
          {picked === "everyone" ? (
            <ConfirmDialog
              title="Make everyone who sends a DM a lead?"
              body={<>From now on each new Instagram and Messenger DM person becomes a lead right away and starts your new-lead automations, webhooks and field-service push. {confirmCopy("changes_sending")}</>}
              confirmLabel="Make them leads"
              onConfirm={(grant) => save(grant)}
              trigger={<WriteButton type="button" size="sm" disabled={pending}>Save</WriteButton>}
            />
          ) : (
            <WriteButton type="button" size="sm" onClick={() => void save()} disabled={pending}>Save</WriteButton>
          )}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-graphite/50 bg-coal/40 p-3">
        <h3 className="text-sm font-semibold text-bone">Tidy up Leads</h3>
        <p className="text-xs text-steel">
          Instagram and Messenger people who became New leads before, and never shared a phone or email, booked or got a deal, can move back to
          Messages. Their conversations stay. Nothing is sent and no automation runs.
          {typeof settings.data?.dm_leads_to_move === "number" ? ` Zuops counts ${settings.data.dm_leads_to_move} right now.` : ""}
        </p>
        {count === null ? (
          <WriteButton type="button" size="sm" variant="secondary" onClick={countThem} disabled={pending}>
            <Users className="size-4" aria-hidden />Count them
          </WriteButton>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="mr-auto text-sm text-bone">{moveCountText(count)}</p>
            <Button type="button" size="sm" variant="ghost" className={TOUCH} onClick={() => setCount(null)}>Not now</Button>
            {count > 0 && (
              <ConfirmDialog
                title={`Move ${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"} back to Messages?`}
                body={
                  <>
                    {moveCountText(count)}. They leave Leads and their new-lead automations stop for them; their conversations stay.
                    Nothing is sent to them. {confirmCopy("changes_sending")}
                  </>
                }
                confirmLabel={`Move ${count.toLocaleString("en-US")}`}
                onConfirm={moveThem}
                trigger={
                  <WriteButton type="button" size="sm" disabled={pending}>
                    Move {count.toLocaleString("en-US")} {count === 1 ? "person" : "people"}
                  </WriteButton>
                }
              />
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </section>
  );
}

function CommentsSection({ accounts }: { accounts: SocialAccount[] }) {
  const nav = useCrmNav();
  const [filters, setFilters] = React.useState<CommentFilters>(EMPTY_COMMENT_FILTERS);
  const search = useDebounced(filters.search, 300);
  const server = { ...filters, search };
  const sig = JSON.stringify(commentsQuery(server, 0));
  const [page, setPage] = React.useState({ sig, offset: 0 });
  const offset = page.sig === sig ? page.offset : 0;
  const comments = useZuRead<SocialCommentsResponse>(SOCIAL_OP.comments, { query: commentsQuery(server, offset) }, { kinds: ["message"], keepPrevious: true });
  const set = (patch: Partial<CommentFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const rows = comments.data?.comments ?? [];
  const counts = comments.data?.counts;
  const statusLabel = (s: CommentFilters["status"], word: string) => {
    const n = counts?.[s === "all" ? "all" : s];
    return typeof n === "number" ? `${word} (${n})` : word;
  };

  return (
    <section aria-labelledby="soc-com-h" className="space-y-3">
      <h2 id="soc-com-h" className="font-grotesk text-base font-semibold text-bone">Comments the comment-to-DM rules saw</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 space-y-1 sm:min-w-56">
          <Label htmlFor="soc-com-search">Search comments</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
            <Input id="soc-com-search" type="search" maxLength={100} className={cn("pl-9", TOUCH)} placeholder="Commenter or comment text" value={filters.search} onChange={(e) => set({ search: e.target.value })} />
          </div>
        </div>
        <div className="min-w-0 space-y-1 sm:w-44">
          <Label htmlFor="soc-com-status">DM result</Label>
          <Select value={filters.status} onValueChange={(v) => set({ status: v as CommentFilters["status"] })}>
            <SelectTrigger id="soc-com-status" className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{statusLabel("all", "Any result")}</SelectItem>
              <SelectItem value="sent">{statusLabel("sent", "Sent")}</SelectItem>
              <SelectItem value="failed">{statusLabel("failed", "Failed")}</SelectItem>
              <SelectItem value="skipped">{statusLabel("skipped", "Skipped")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1 sm:w-48">
          <Label htmlFor="soc-com-account">Account</Label>
          <Select value={filters.account} onValueChange={(v) => set({ account: v })}>
            <SelectTrigger id="soc-com-account" className={TOUCH}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every account</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name || a.username || a.page_name || "Account"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="soc-com-from">From</Label>
          <Input id="soc-com-from" type="date" className={cn("w-auto", TOUCH)} value={filters.from} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="soc-com-to">To</Label>
          <Input id="soc-com-to" type="date" className={cn("w-auto", TOUCH)} value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox id="soc-com-oldest" checked={filters.oldestFirst} onCheckedChange={(v) => set({ oldestFirst: v === true })} />
          <Label htmlFor="soc-com-oldest" className="text-sm text-bone">Oldest first</Label>
        </div>
      </div>

      {comments.error && !comments.data ? errorView(comments.error, comments.refresh)
        : comments.loading ? <div aria-busy="true" aria-label="Loading comments"><SkeletonRows rows={4} /></div>
          : rows.length === 0 ? (
            <EmptyState icon={MessageCircle} title={JSON.stringify(filters) === JSON.stringify(EMPTY_COMMENT_FILTERS) ? "No comments yet" : "No comments match"} description="Comments that match a comment-to-DM rule on your posts and reels show up here." />
          ) : (
            <>
              {comments.error && <p role="alert" className="text-xs text-caution">Showing the last copy. {comments.error.reason}</p>}
              <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40" aria-busy={comments.refreshing || undefined}>
                {rows.map((c) => {
                  const dm = dmStatus(c.dm_status);
                  return (
                    <li key={c.id} className="space-y-1.5 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-bone">{c.commenter?.name || "Someone"}</span>
                        <span className="text-xs text-steel">{platformWord(c.platform)}{c.account?.name ? ` · ${c.account.name}` : ""}</span>
                        <span className="ml-auto text-[0.6875rem] tabular-nums text-steel">{relTime(c.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-bone">{c.text || "(no text)"}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-steel">
                        {c.post_id && <span>Post {c.post_id}</span>}
                        {c.rule?.name && <span>Rule: {c.rule.name}</span>}
                        <span>{c.public_reply ? "Public reply posted" : "No public reply"}</span>
                        <Badge tone={dm.tone}>{dm.word}</Badge>
                      </p>
                      {c.dm_status === "failed" && c.error && <p className="text-xs text-critical">{c.error}</p>}
                      {c.lead_id && (
                        <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => nav.openInbox(c.lead_id!)}>
                          <Inbox className="size-4" aria-hidden />Open conversation
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

      {(rows.length > 0 || offset > 0) && (
        <nav aria-label="Comment pages" className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-xs text-steel">{rows.length ? `Showing ${offset + 1} to ${offset + rows.length}${typeof counts?.all === "number" ? ` of ${counts.all}` : ""}` : "Nothing on this page"}</span>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={offset === 0} onClick={() => setPage({ sig, offset: Math.max(0, offset - COMMENTS_PAGE) })}>
            <ChevronLeft className="size-4" aria-hidden />Previous
          </Button>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} disabled={!comments.data?.has_more || comments.data?.next_offset == null}
            onClick={() => setPage({ sig, offset: comments.data?.next_offset ?? offset + COMMENTS_PAGE })}>
            Next<ChevronRight className="size-4" aria-hidden />
          </Button>
        </nav>
      )}
    </section>
  );
}

function DmsSection() {
  const nav = useCrmNav();
  const ig = useZuRead<MessagesResponse>(SOCIAL_OP.messages, { query: { channel: "instagram", limit: 25 } }, { kinds: ["message"] });
  const fb = useZuRead<MessagesResponse>(SOCIAL_OP.messages, { query: { channel: "messenger", limit: 25 } }, { kinds: ["message"] });
  const error = ig.error && !ig.data ? ig.error : fb.error && !fb.data ? fb.error : null;
  const list = mergeDms(ig.data?.messages ?? [], fb.data?.messages ?? []);
  return (
    <section aria-labelledby="soc-dm-h" className="space-y-3">
      <h2 id="soc-dm-h" className="font-grotesk text-base font-semibold text-bone">Recent DMs</h2>
      <p className="text-xs text-steel">The newest 25 on each of Instagram and Messenger. Reply from the conversation in the Inbox, within 24 hours of their last message.</p>
      {error && !list.length ? errorView(error, () => { ig.refresh(); fb.refresh(); })
        : ig.loading || fb.loading ? <div aria-busy="true" aria-label="Loading DMs"><SkeletonRows rows={4} /></div>
          : list.length === 0 ? <EmptyState icon={MessagesSquare} title="No DMs yet" description="Instagram and Messenger messages show up here once an account is connected." />
            : (
              <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40">
                {list.map((m) => {
                  const leadId = m.lead_id ?? m.lead?.id ?? null;
                  const Icon = PLATFORM_ICON(m.channel);
                  return (
                    <li key={m.id} className="flex flex-wrap items-start gap-2 px-3 py-2.5 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap gap-2">
                          <span className="font-semibold text-bone">{m.lead?.full_name || "Unknown person"}</span>
                          <span className="text-xs text-steel">{platformWord(m.channel)} · {m.direction === "outbound" ? `Sent${m.social?.sent_by ? ` by ${m.social.sent_by}` : ""}` : "Received"} · {relTime(m.created_at)}</span>
                        </p>
                        <p className="line-clamp-2 break-words text-steel">{m.body || (m.media_urls?.length ? "Sent a picture or file" : "(no text)")}</p>
                      </div>
                      {leadId && (
                        <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => nav.openInbox(leadId)}>
                          <Inbox className="size-4" aria-hidden />Open conversation
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
    </section>
  );
}
