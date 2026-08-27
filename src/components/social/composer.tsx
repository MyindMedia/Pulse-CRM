"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Platform } from "@convex/lib/ghl";
import { Section } from "@/components/ui/page";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Checkbox, Switch } from "@/components/ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { useCapabilities } from "@/lib/use-capabilities";
import { PLATFORM_META } from "./platforms";
import { TemplatePicker, isTemplateKey, type TemplateKey } from "./template-picker";
import { MediaPicker, type MediaItem } from "./media-picker";
import { SchedulePicker, type ScheduleValue } from "./schedule-picker";
import { previewWarnings } from "./rules-preview";
import { scheduleSuggestions } from "./schedule-math";
import { applyLinkInBioSuffix, nextMixBaseline } from "./link-in-bio";
import { cn } from "@/lib/utils";

/** Facts handed to suggestCaption: whatever the composer already knows about
 *  the room, promo and artist, in plain sentences the model can quote from
 *  instead of inventing. */
function buildFacts(opts: {
  studioName?: string;
  room?: { name: string; roomType?: string } | null;
  promo?: { code: string; pct: number; label?: string; startsAt: number; endsAt: number } | null;
  artist?: { name: string } | null;
  template: TemplateKey;
}): string {
  const lines: string[] = [];
  if (opts.studioName) lines.push(`Studio: ${opts.studioName}.`);
  if (opts.room) lines.push(`Room: ${opts.room.name}${opts.room.roomType ? `, a ${opts.room.roomType}` : ""}.`);
  if (opts.promo) {
    const fmt = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    lines.push(
      `Promo code ${opts.promo.code}: ${opts.promo.pct}% off${opts.promo.label ? `, ${opts.promo.label}` : ""}. Valid ${fmt(opts.promo.startsAt)} to ${fmt(opts.promo.endsAt)}.`,
    );
  }
  if (opts.artist && opts.template === "client_win") lines.push(`Artist: ${opts.artist.name}.`);
  if (lines.length === 0) lines.push("No specific facts given. Keep it general, warm and inviting.");
  return lines.join("\n");
}

// A loaded post's editable window: update() (convex/marketing/posts.ts)
// rejects anything outside draft/approved/failed with a status-specific
// message, but nothing in the UI said so before that throw. Shown as a
// banner the moment a post loads, and used to lock the whole form so a
// scheduled/published/cancelled post never lets an owner type into a form
// that cannot be saved.
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed to schedule",
  cancelled: "Cancelled",
};
const EDITABLE_STATUSES = new Set(["draft", "approved", "failed"]);

export function Composer({
  initialPostId,
  template,
  promoId,
}: {
  initialPostId?: Id<"socialPosts">;
  template?: string | null;
  promoId?: Id<"promos"> | null;
}) {
  const router = useRouter();
  const { can, loaded: capsLoaded } = useCapabilities();
  const canEdit = can("marketing.edit");
  const canApprove = can("marketing.approve");

  const existingPost = useQuery(api.marketing.posts.get, initialPostId ? { id: initialPostId } : "skip");
  const accounts = useQuery(api.marketing.accounts.list, {});
  const promos = useQuery(api.promos.list, {});
  const rooms = useQuery(api.rooms.list, {});
  const artists = useQuery(api.artists.list, {});
  const org = useQuery(api.orgs.current, {});

  const createPost = useMutation(api.marketing.posts.create);
  const updatePost = useMutation(api.marketing.posts.update);
  const approvePost = useMutation(api.marketing.posts.approve);
  const suggestCaption = useAction(api.marketing.posts.suggestCaption);

  const [postId, setPostId] = React.useState<Id<"socialPosts"> | undefined>(initialPostId);
  const [templateKey, setTemplateKey] = React.useState<TemplateKey | null>(
    isTemplateKey(template) ? template : null,
  );
  const [caption, setCaption] = React.useState("");
  const [media, setMedia] = React.useState<MediaItem[]>([]);
  const [accountIds, setAccountIds] = React.useState<Id<"socialAccounts">[]>([]);
  const [roomIdState, setRoomIdState] = React.useState<Id<"rooms"> | undefined>(undefined);
  const [promoIdState, setPromoIdState] = React.useState<Id<"promos"> | undefined>(promoId ?? undefined);
  const [artistIdState, setArtistIdState] = React.useState<Id<"artists"> | undefined>(undefined);
  const [includeBookingLink, setIncludeBookingLink] = React.useState(true);
  const [schedule, setSchedule] = React.useState<ScheduleValue | null>(null);
  const [scheduleTouched, setScheduleTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);
  // The loaded post's own status (null for a fresh, unsaved compose). Drives
  // the status banner and locks the whole form once a post has moved past
  // the editable window - update() rejects a scheduled/published/cancelled
  // post server-side, so the UI has to say so before the owner types rather
  // than surface that as a save-time error.
  const [loadedStatus, setLoadedStatus] = React.useState<string | null>(null);

  // Load an existing draft into local state exactly once per post id - a
  // later revalidation of the SAME id (e.g. the status-sync cron touching
  // this row) must not silently overwrite what the owner is typing, but
  // navigating from one ?post= link to another without a full page reload
  // (two inbox rows opened in sequence) must load the new one. Keyed on the
  // id itself, not a bare "have I ever loaded anything" flag.
  const loadedForRef = React.useRef<Id<"socialPosts"> | undefined>(undefined);
  // Baseline for the account-mix watcher below - declared here, alongside
  // loadedForRef, so the load effect can reset it the moment a DIFFERENT
  // post's data lands. Every other field-restoring setState below has this
  // same "new post, clean slate" property; this ref needs it too, or a
  // stale baseline from post A gets compared against post B's freshly
  // restored mix and overwrites the includeBookingLink value just restored
  // for B.
  const mixBaselineRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!initialPostId || loadedForRef.current === initialPostId) return;
    if (existingPost === undefined) return; // still loading this id
    loadedForRef.current = initialPostId;
    mixBaselineRef.current = null;
    if (existingPost === null) {
      setNotFound(true);
      return;
    }
    setNotFound(false);
    setPostId(existingPost._id);
    setTemplateKey(existingPost.template);
    setCaption(existingPost.caption);
    setMedia(existingPost.media);
    setAccountIds(existingPost.accountIds);
    setRoomIdState(existingPost.roomId);
    setPromoIdState(existingPost.promoId);
    setArtistIdState(existingPost.artistId);
    setIncludeBookingLink(Boolean(existingPost.link));
    setSchedule({ scheduledFor: existingPost.scheduledFor, timezone: existingPost.timezone });
    setScheduleTouched(true);
    setLoadedStatus(existingPost.status);
  }, [existingPost, initialPostId]);

  // Default the schedule to the studio's own timezone once org data resolves
  // (falling back to the browser's zone before then), as long as the owner
  // has not picked anything yet.
  React.useEffect(() => {
    if (scheduleTouched || org === undefined) return;
    const tz = org?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    setSchedule({ scheduledFor: scheduleSuggestions(Date.now(), tz)[0].scheduledFor, timezone: tz });
  }, [org, scheduleTouched]);

  const allInstagramSelected =
    accountIds.length > 0 && accounts !== undefined && accountIds.every((id) => accounts.find((a) => a._id === id)?.platform === "instagram");

  // "Link in bio" beats a dead link: Instagram does not render a clickable
  // link in a caption, so the default flips off there. This re-applies
  // whenever the account MIX changes (not on every render, and not via a
  // sticky "touched" flag) so three things are all true at once: reopening a
  // draft restores its persisted includeBookingLink untouched; widening or
  // narrowing the account selection later re-applies the sensible default
  // for the new mix; and a manual toggle survives until the mix actually
  // changes again. The baseline is only captured once a post (if any) has
  // finished loading, so hydrating a saved draft's own accountIds is never
  // itself mistaken for a "mix changed" event that overrides the value the
  // load effect just restored - and the load effect resets the baseline to
  // null whenever a DIFFERENT post lands, so the same is true switching
  // between two posts in one mount. The three-way decision (first sighting,
  // genuine change, no change) is a pure function - see nextMixBaseline in
  // link-in-bio.ts and its own tests - so this effect is just wiring.
  React.useEffect(() => {
    if (accounts === undefined) return; // mix unknown until accounts resolve
    if (initialPostId && loadedForRef.current !== initialPostId) return; // post not hydrated yet
    const { reapplyDefault, baseline } = nextMixBaseline(mixBaselineRef.current, allInstagramSelected);
    mixBaselineRef.current = baseline;
    if (reapplyDefault) setIncludeBookingLink(!allInstagramSelected);
  }, [accounts, allInstagramSelected, initialPostId]);

  const readOnlyStatus = loadedStatus !== null && !EDITABLE_STATUSES.has(loadedStatus);

  const selectedRoom = rooms?.find((r) => r._id === roomIdState) ?? null;
  const selectedPromo = promos?.find((p) => p._id === promoIdState) ?? null;
  const selectedArtist = artists?.find((a) => a._id === artistIdState) ?? null;

  const warningsByAccount = React.useMemo(() => {
    if (!accounts) return new Map<string, string[]>();
    const candidates = accounts.map((a) => ({ _id: a._id, platform: a.platform }));
    const problems = previewWarnings(candidates, {
      caption,
      media: media.map((m) => m.type),
      hasLink: includeBookingLink,
    });
    return new Map(problems.map((p) => [p.accountId, p.problems]));
  }, [accounts, caption, media, includeBookingLink]);

  function toggleAccount(id: Id<"socialAccounts">, on: boolean) {
    setAccountIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  async function handleDraftWithAI() {
    if (!templateKey) return;
    setAiBusy(true);
    try {
      const facts = buildFacts({
        studioName: org?.name,
        room: selectedRoom ? { name: selectedRoom.name, roomType: selectedRoom.roomType } : null,
        promo: selectedPromo,
        artist: selectedArtist,
        template: templateKey,
      });
      const singlePlatform: Platform | undefined =
        accountIds.length === 1 ? accounts?.find((a) => a._id === accountIds[0])?.platform : undefined;
      const text = await suggestCaption({ template: templateKey, facts, platform: singlePlatform });
      if (text) {
        setCaption(text);
        toast.success("Caption drafted.");
      } else {
        toast("No AI suggestion available right now. Your caption is unchanged.");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Could not draft a caption. Try again."));
    } finally {
      setAiBusy(false);
    }
  }

  function finalCaption(): string {
    return applyLinkInBioSuffix(caption, { allInstagramSelected, includeBookingLink });
  }

  function buildArgs() {
    if (!templateKey || !schedule) return null;
    return {
      template: templateKey,
      caption: finalCaption(),
      media,
      accountIds,
      scheduledFor: schedule.scheduledFor,
      timezone: schedule.timezone,
      promoId: templateKey === "rate_promo" || templateKey === "open_slot" ? promoIdState : undefined,
      artistId: templateKey === "client_win" ? artistIdState : undefined,
      roomId: roomIdState,
      ghlType: "post" as const,
      includeBookingLink,
    };
  }

  /** Why buildArgs() would refuse to build: distinct copy for a template not
   *  yet picked (the owner's move) versus a schedule that has not defaulted
   *  yet (a race - the org-timezone effect resolves within a render or two
   *  of mount, and the footer buttons render before that finishes). Without
   *  this, a fast click during "Loading schedule" told the owner to pick a
   *  template they had already picked. */
  function missingReason(): string | null {
    if (!templateKey) return "Pick a template first.";
    if (!schedule) return "Still loading the schedule. Try again in a moment.";
    return null;
  }

  async function handleSaveDraft() {
    if (readOnlyStatus) return;
    const reason = missingReason();
    if (reason) {
      toast.error(reason);
      return;
    }
    const args = buildArgs();
    if (!args) {
      toast.error("Could not save this draft. Try again.");
      return;
    }
    setSaving(true);
    try {
      if (postId) {
        await updatePost({ id: postId, ...args });
      } else {
        const id = await createPost(args);
        setPostId(id);
        router.replace(`/marketing/compose?post=${id}`);
      }
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save this draft. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveAndSchedule() {
    if (readOnlyStatus) return;
    const reason = missingReason();
    if (reason) {
      toast.error(reason);
      return;
    }
    const args = buildArgs();
    if (!args) {
      toast.error("Could not approve this post. Try again.");
      return;
    }
    setApproving(true);
    try {
      let id = postId;
      if (id) {
        await updatePost({ id, ...args });
      } else {
        id = await createPost(args);
        setPostId(id);
        router.replace(`/marketing/compose?post=${id}`);
      }
      await approvePost({ id });
      toast.success("Approved and scheduled.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not approve this post. Try again."));
    } finally {
      setApproving(false);
    }
  }

  if (!capsLoaded || (initialPostId && existingPost === undefined)) {
    return <LoadingPanel label="Loading composer" />;
  }

  if (notFound) {
    return (
      <EmptyState
        title="Draft not found"
        description="This draft may have been removed, or it belongs to a different studio."
        action={
          <Button asChild variant="outline">
            <Link href="/marketing">Back to the calendar</Link>
          </Button>
        }
      />
    );
  }

  if (!canEdit) {
    return (
      <EmptyState
        title="You can view marketing, not write it"
        description="Only a studio owner, manager, producer, or engineer can write and schedule a post. Ask one of them, or open the calendar to see what is already planned."
        action={
          <Button asChild variant="outline">
            <Link href="/marketing">Open the calendar</Link>
          </Button>
        }
      />
    );
  }

  const busy = saving || approving;
  const locked = busy || readOnlyStatus;

  return (
    <div className="space-y-8">
      {loadedStatus && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            readOnlyStatus ? "border-critical/40 bg-critical/10 text-critical" : "border-graphite/50 bg-coal-2 text-steel",
          )}
        >
          <span className="font-medium">Status: {STATUS_LABEL[loadedStatus] ?? loadedStatus}.</span>{" "}
          {readOnlyStatus &&
            "This post can no longer be edited here. Its content is shown below for reference only."}
        </div>
      )}
      <Section title="Template">
        <TemplatePicker value={templateKey} onPick={setTemplateKey} disabled={locked} />
      </Section>

      {templateKey && (
        <>
          <Section title="Media">
            <MediaPicker
              value={media}
              onChange={setMedia}
              template={templateKey}
              postId={postId}
              updatedAt={existingPost?.updatedAt}
              disabled={locked}
            />
          </Section>

          <Section title="Room">
            <Select
              value={roomIdState ?? "none"}
              onValueChange={(v) => setRoomIdState(v === "none" ? undefined : (v as Id<"rooms">))}
              disabled={locked}
            >
              <SelectTrigger>
                <SelectValue placeholder="No specific room" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific room</SelectItem>
                {(rooms ?? []).map((r) => (
                  <SelectItem key={r._id} value={r._id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Section>

          <Section
            title="Caption"
            trailing={
              <Button variant="outline" size="sm" onClick={() => void handleDraftWithAI()} disabled={locked || aiBusy}>
                <Sparkles className="size-3.5" />
                {aiBusy ? "Drafting..." : "Draft with AI"}
              </Button>
            }
          >
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              disabled={locked}
              placeholder="What happened, and what should they do next."
            />
          </Section>

          <Section title="Accounts">
            {accounts === undefined ? null : accounts.length === 0 ? (
              <EmptyState
                title="No accounts connected"
                description="Connect Instagram, Facebook, or Google Business Profile first."
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/marketing/accounts">Connect an account</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {accounts.map((a) => {
                  const meta = PLATFORM_META[a.platform];
                  const checked = accountIds.includes(a._id);
                  const warnings = warningsByAccount.get(a._id);
                  return (
                    <li key={a._id} className="rounded-lg border border-graphite/50 bg-coal-2 px-3 py-2.5">
                      <label className="flex cursor-pointer items-center gap-3">
                        <Checkbox
                          checked={checked}
                          disabled={locked}
                          onCheckedChange={(v) => toggleAccount(a._id, Boolean(v))}
                        />
                        <meta.icon className="size-4 shrink-0 text-steel/70" />
                        <span className="text-sm text-bone">{a.name}</span>
                        <span className="text-xs text-steel/70">{meta.label}</span>
                      </label>
                      {warnings && warnings.length > 0 && (
                        <ul className="ml-9 mt-1 space-y-0.5">
                          {warnings.map((w) => (
                            <li key={w} className="text-xs text-critical">
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {(templateKey === "rate_promo" || templateKey === "open_slot") && (
            <Section
              title="Promo"
              trailing={
                <Link href="/marketing/promos" className="text-xs text-gold underline">
                  New promo
                </Link>
              }
            >
              <Select
                value={promoIdState ?? "none"}
                onValueChange={(v) => setPromoIdState(v === "none" ? undefined : (v as Id<"promos">))}
                disabled={locked}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No promo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No promo</SelectItem>
                  {(promos ?? [])
                    .filter((p) => p.active)
                    .map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.code}: {p.pct}% off{p.label ? `, ${p.label}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Section>
          )}

          {templateKey === "client_win" && (
            <Section title="Artist">
              <Select
                value={artistIdState ?? "none"}
                onValueChange={(v) => setArtistIdState(v === "none" ? undefined : (v as Id<"artists">))}
                disabled={locked}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick an artist" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Pick an artist</SelectItem>
                  {(artists ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedArtist && (
                <p className={selectedArtist.okToFeature ? "text-xs text-positive" : "text-xs text-critical"}>
                  {selectedArtist.okToFeature
                    ? "OK to feature."
                    : "This artist has not given the OK to feature yet. Ask them, then tick it on their profile before you approve."}
                </p>
              )}
            </Section>
          )}

          <Section title="Booking link">
            <label className="flex cursor-pointer items-center gap-3">
              <Switch
                checked={includeBookingLink}
                disabled={locked}
                onCheckedChange={setIncludeBookingLink}
              />
              <span className="text-sm text-bone">Include the booking link</span>
            </label>
            <p className="mt-1 text-xs text-steel/70">
              {allInstagramSelected
                ? 'Every account picked is Instagram, where a link in the caption is not clickable. "Link in bio" is appended instead when this is off.'
                : "Tracks which post drove a booking."}
            </p>
          </Section>

          <Section title="Schedule">
            {schedule ? (
              <SchedulePicker
                value={schedule}
                onChange={(next) => {
                  setScheduleTouched(true);
                  setSchedule(next);
                }}
                disabled={locked}
              />
            ) : (
              <LoadingPanel label="Loading schedule" />
            )}
          </Section>

          <div className="flex flex-wrap items-center gap-3 border-t border-graphite/40 pt-6">
            <Button onClick={() => void handleSaveDraft()} disabled={locked}>
              {saving ? "Saving..." : "Save draft"}
            </Button>
            {canApprove ? (
              <Button variant="secondary" onClick={() => void handleApproveAndSchedule()} disabled={locked}>
                {approving ? "Scheduling..." : "Approve and schedule"}
              </Button>
            ) : (
              <p className="text-xs text-steel/70">Ask a studio owner or manager to approve and schedule this once you save it.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
