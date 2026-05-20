"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ArrowLeft,
  AtSign,
  CalendarPlus,
  DollarSign,
  Mail,
  MapPin,
  Music2,
  Pencil,
  Phone,
  Receipt,
  UserX,
  CalendarCheck,
  Wallet,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, relativeTime, shortDate, timeOfDay, duration } from "@/lib/format";
import {
  meta,
  ARTIST_STATUS,
  RELIABILITY,
  SONG_STAGE,
  SESSION_STATUS,
  INVOICE_STATUS,
} from "@/lib/labels";
import { GenreChips } from "@/components/roster/genre-chips";
import { ActivityTimeline } from "@/components/roster/activity-timeline";
import { NotesPanel } from "@/components/roster/notes-panel";
import { EditArtistDialog, type EditableArtist } from "@/components/roster/edit-artist-dialog";
import { artistTypeLabel } from "@/components/roster/constants";

/* ── Social link helpers ───────────────────────────────────── */

function instagramUrl(handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle;
  return `https://instagram.com/${handle.replace(/^@/, "")}`;
}

function spotifyUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://open.spotify.com/search/${encodeURIComponent(value)}`;
}

/* ── Page ──────────────────────────────────────────────────── */

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const artistId = id as Id<"artists">;
  const data = useQuery(api.artists.get, { id: artistId });

  const [editOpen, setEditOpen] = React.useState(false);

  if (data === undefined) return <ArtistDetailSkeleton />;

  if (data === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={UserX}
          title="Artist not found"
          description="This roster contact may have been removed or the link is out of date."
          action={
            <Button asChild variant="secondary">
              <Link href="/roster">Back to roster</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const st = meta(ARTIST_STATUS, data.status);
  const rel = meta(RELIABILITY, data.reliability);

  const editable: EditableArtist = {
    _id: data._id,
    name: data.name,
    status: data.status,
    reliability: data.reliability,
    instagram: data.instagram,
    spotify: data.spotify,
  };

  return (
    <div className="space-y-7">
      <BackLink />

      {/* Hero */}
      <div className="rounded-xl border border-hairline bg-coal p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={data.name} color={data.avatarColor} size="lg" />

          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl font-bold tracking-tight text-bone">
                {data.name}
              </h1>
              <Badge tone="neutral">{artistTypeLabel(data.type)}</Badge>
              <Badge tone={st.tone}>{st.label}</Badge>
              <Badge tone={rel.tone} dot>
                {rel.label}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ash">
              {data.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5 text-ash-dim" />
                  {data.location}
                </span>
              )}
              {data.email && (
                <a
                  href={`mailto:${data.email}`}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-bone"
                >
                  <Mail className="size-3.5 text-ash-dim" />
                  {data.email}
                </a>
              )}
              {data.phone && (
                <a
                  href={`tel:${data.phone}`}
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-bone"
                >
                  <Phone className="size-3.5 text-ash-dim" />
                  {data.phone}
                </a>
              )}
              {data.instagram && (
                <a
                  href={instagramUrl(data.instagram)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-gold transition-colors hover:text-gold-bright"
                >
                  <AtSign className="size-3.5" />
                  Instagram
                </a>
              )}
              {data.spotify && (
                <a
                  href={spotifyUrl(data.spotify)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-gold transition-colors hover:text-gold-bright"
                >
                  <Music2 className="size-3.5" />
                  Spotify
                </a>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <GenreChips items={data.genres} max={6} emptyLabel="No genres set" />
            </div>
            {data.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {data.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              Edit
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/songs?new=1">
                <Music2 className="size-4" />
                New song
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/calendar?new=1">
                <CalendarPlus className="size-4" />
                Book session
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Lifetime value"
          value={money(data.lifetimeValueCents, { compact: true })}
          icon={DollarSign}
          accent
        />
        <StatTile
          label="Sessions"
          value={String(data.sessionCount)}
          icon={CalendarCheck}
        />
        <StatTile
          label="Outstanding"
          value={money(data.outstandingCents, { compact: true })}
          icon={Wallet}
          hint={data.outstandingCents > 0 ? "balance due" : "all settled"}
        />
        <StatTile
          label="Last contact"
          value={data.lastContactAt ? relativeTime(data.lastContactAt) : "-"}
          icon={Clock}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="songs">Songs ({data.songs.length})</TabsTrigger>
          <TabsTrigger value="sessions">Sessions ({data.sessions.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({data.invoices.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* Timeline */}
        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-5">
              <ActivityTimeline artistId={artistId} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Songs */}
        <TabsContent value="songs">
          {data.songs.length === 0 ? (
            <EmptyState
              icon={Music2}
              title="No songs yet"
              description="Songs this artist is credited on will appear here."
              action={
                <Button asChild variant="secondary">
                  <Link href="/songs?new=1">Start a song</Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <CardContent className="divide-y divide-hairline p-0">
                {data.songs.map((song) => {
                  const stage = meta(SONG_STAGE, song.stage);
                  return (
                    <Link
                      key={song._id}
                      href={`/songs/${song._id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-coal-2"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-hairline bg-ink-2 text-ash-dim">
                        <Music2 className="size-4" />
                      </span>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-bone">
                        {song.title}
                      </p>
                      <Badge tone={stage.tone}>{stage.label}</Badge>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Sessions */}
        <TabsContent value="sessions">
          {data.sessions.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="No sessions booked"
              description="Studio sessions with this artist will be listed here."
              action={
                <Button asChild variant="secondary">
                  <Link href="/calendar?new=1">Book a session</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Session</TH>
                  <TH>Date</TH>
                  <TH>Time</TH>
                  <TH>Length</TH>
                  <TH className="text-right">Status</TH>
                </TR>
              </THead>
              <TBody>
                {data.sessions.map((session) => {
                  const status = meta(SESSION_STATUS, session.status);
                  return (
                    <TR key={session._id}>
                      <TD className="font-medium">{session.title}</TD>
                      <TD className="text-ash">{shortDate(session.startTime)}</TD>
                      <TD className="text-ash">{timeOfDay(session.startTime)}</TD>
                      <TD className="font-mono tabular-nums text-ash-dim">
                        {duration(session.startTime, session.endTime)}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </TabsContent>

        {/* Invoices */}
        <TabsContent value="invoices">
          {data.invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No invoices"
              description="Invoices billed to this artist will show up here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Due date</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Status</TH>
                </TR>
              </THead>
              <TBody>
                {data.invoices.map((invoice) => {
                  const status = meta(INVOICE_STATUS, invoice.status);
                  return (
                    <TR
                      key={invoice._id}
                      interactive
                      onClick={() => router.push(`/payments/${invoice._id}`)}
                    >
                      <TD>
                        <Link
                          href={`/payments/${invoice._id}`}
                          className="font-mono font-medium text-bone hover:text-gold"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {invoice.number}
                        </Link>
                      </TD>
                      <TD className="text-ash">{shortDate(invoice.dueDate)}</TD>
                      <TD className="text-right font-mono tabular-nums font-medium text-bone">
                        {money(invoice.amountCents)}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </TabsContent>

        {/* Notes */}
        <TabsContent value="notes">
          <NotesPanel
            artistId={artistId}
            initialNotes={data.notes ?? ""}
            initialTags={data.tags}
          />
        </TabsContent>
      </Tabs>

      <EditArtistDialog artist={editable} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────── */

function BackLink() {
  return (
    <Link
      href="/roster"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ash transition-colors hover:text-bone"
    >
      <ArrowLeft className="size-3.5" />
      Back to roster
    </Link>
  );
}

function ArtistDetailSkeleton() {
  return (
    <div className="space-y-7">
      <Skeleton className="h-4 w-28" />
      <div className="rounded-xl border border-hairline bg-coal p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Skeleton className="size-14 rounded-md" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-9 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
