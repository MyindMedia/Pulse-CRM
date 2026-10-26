"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Coins, FileUp, Hourglass, Link2, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { UploadStatementDialog } from "@/components/royalties/upload-statement-dialog";
import { MatchLineDialog, type UnmatchedLine } from "@/components/royalties/match-line-dialog";
import { ContributorSheet } from "@/components/royalties/contributor-sheet";
import { amount, amounts, period, SOURCE_LABEL } from "@/components/royalties/format";

/* Royalties: distributor statements divided by the signed split sheets.
   Pulse keeps the ledger; the studio pays contributors itself and marks
   them paid here. Shown only for Max studios whose agency turned it on. */

export default function RoyaltiesPage() {
  const status = useQuery(api.royalties.status);
  if (status === undefined) return <SkeletonCards cards={4} />;
  if (!status.available) {
    const copy =
      status.reason === "upgrade"
        ? { title: "Royalties are on the Max plan", body: "Upload distributor statements and divide them by your signed split sheets." }
        : status.reason === "role"
          ? { title: "Only owners and managers see royalties", body: "Ask the studio owner if you need a contributor's statement." }
          : { title: "Royalties aren't switched on yet", body: "Your account manager turns this on when it's ready for your studio." };
    return (
      <div className="space-y-6">
        <PageHeader overline="Catalog" title="Royalties" />
        <EmptyState
          icon={Coins}
          title={copy.title}
          description={copy.body}
          action={
            status.reason === "upgrade" ? (
              <Button asChild>
                <Link href="/settings?tab=billing">See plans</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return <RoyaltiesLedger />;
}

function RoyaltiesLedger() {
  const statements = useQuery(api.royalties.statements);
  const queues = useQuery(api.royalties.queues);
  const people = useQuery(api.royalties.contributors);
  const songs = useQuery(api.royalties.songs);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [matching, setMatching] = React.useState<UnmatchedLine | null>(null);
  const [person, setPerson] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState("contributors");

  const owed = React.useMemo(() => {
    const t: Record<string, number> = {};
    for (const p of people ?? []) for (const o of p.owed) t[o.currency] = (t[o.currency] ?? 0) + o.cents;
    return Object.entries(t).map(([currency, cents]) => ({ currency, cents }));
  }, [people]);
  const waiting = React.useMemo(() => {
    const t: Record<string, number> = {};
    for (const s of queues?.unallocated ?? []) for (const o of s.totals) t[o.currency] = (t[o.currency] ?? 0) + o.cents;
    return Object.entries(t).map(([currency, cents]) => ({ currency, cents }));
  }, [queues]);
  const attention = (queues?.unallocated.length ?? 0) + (queues?.unmatched.length ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Catalog"
        title="Royalties"
        description="Distributor statements divided by each song's signed split sheet. Pulse keeps the record; you pay contributors and mark them paid."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <FileUp className="size-4" />
            Upload statement
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Owed to contributors" value={people ? amounts(owed) : "…"} icon={Users} accent />
        <StatTile
          label="Waiting on signatures"
          value={queues ? amounts(waiting) : "…"}
          icon={Hourglass}
          hint={queues ? `${queues.unallocated.length} songs` : undefined}
          onClick={() => setTab("attention")}
        />
        <StatTile
          label="Unmatched earnings"
          value={queues ? String(queues.unmatched.length) : "…"}
          icon={Link2}
          hint="Lines with no song yet"
          onClick={() => setTab("attention")}
        />
        <StatTile label="Statements" value={statements ? String(statements.length) : "…"} icon={Coins} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="contributors">Contributors</TabsTrigger>
          <TabsTrigger value="attention">
            Needs attention{attention ? ` (${attention})` : ""}
          </TabsTrigger>
          <TabsTrigger value="songs">Songs</TabsTrigger>
          <TabsTrigger value="statements">Statements</TabsTrigger>
        </TabsList>

        <TabsContent value="contributors" className="pt-4">
          {people === undefined ? (
            <SkeletonCards cards={3} />
          ) : people.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No shares yet"
              description="Upload a statement. Earnings on songs with a fully signed split sheet are divided here."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Contributor</TH>
                    <TH>Songs</TH>
                    <TH className="text-right">Owed</TH>
                    <TH className="text-right">Paid</TH>
                  </TR>
                </THead>
                <TBody>
                  {people.map((p) => (
                    <TR key={p.key} className="cursor-pointer" onClick={() => setPerson(p.key)}>
                      <TD>
                        <button type="button" className="text-left" onClick={() => setPerson(p.key)}>
                          <span className="block font-medium text-bone">{p.name}</span>
                          <span className="block text-xs text-steel/70">{p.email ?? "No email on the sheet"}</span>
                        </button>
                      </TD>
                      <TD>{p.songs}</TD>
                      <TD className="text-right font-meta text-bone">{p.owed.length ? amounts(p.owed) : "Nothing"}</TD>
                      <TD className="text-right font-meta text-steel">{p.paid.length ? amounts(p.paid) : "Nothing yet"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="attention" className="space-y-6 pt-4">
          <section className="space-y-2">
            <h2 className="font-grotesk text-sm font-semibold text-bone">Waiting on signatures</h2>
            <p className="text-xs text-steel/80">
              Earnings on a song whose split sheet isn&apos;t fully signed are held, then divided the moment the last person signs.
            </p>
            {queues === undefined ? (
              <SkeletonCards cards={2} />
            ) : queues.unallocated.length === 0 ? (
              <p className="text-sm text-steel">Nothing is waiting.</p>
            ) : (
              <ul className="space-y-1.5">
                {queues.unallocated.map((s) => (
                  <li key={s.songId} className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-bone">{s.title}</span>
                      <span className="block truncate text-xs text-steel/70">{s.artistName}</span>
                    </span>
                    <span className="font-meta text-sm text-bone">{amounts(s.totals)}</span>
                    <Badge tone="caution">
                      {s.waitingOn === null
                        ? "No split sheet"
                        : `Waiting on ${s.waitingOn} ${s.waitingOn === 1 ? "signature" : "signatures"}`}
                    </Badge>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/splits/${s.songId}`}>{s.waitingOn === null ? "Start sheet" : "Open sheet"}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-grotesk text-sm font-semibold text-bone">Unmatched earnings</h2>
            <p className="text-xs text-steel/80">Lines whose ISRC matches no song here. Match each one once; the song keeps the ISRC for next time.</p>
            {queues === undefined ? (
              <SkeletonCards cards={2} />
            ) : queues.unmatched.length === 0 ? (
              <p className="text-sm text-steel">Every line is matched.</p>
            ) : (
              <ul className="space-y-1.5">
                {queues.unmatched.map((l) => (
                  <li key={l._id} className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-bone">{l.title ?? "Untitled line"}</span>
                      <span className="block truncate text-xs text-steel/70">
                        {[l.artist, l.isrc].filter(Boolean).join(" · ") || "No ISRC"}
                      </span>
                    </span>
                    <span className="font-meta text-sm text-bone">{amount(l.amountCents, l.currency)}</span>
                    <Button size="sm" onClick={() => setMatching(l)}>
                      Match
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="songs" className="pt-4">
          {songs === undefined ? (
            <SkeletonCards cards={3} />
          ) : songs.length === 0 ? (
            <EmptyState icon={Coins} title="No matched earnings yet" description="Earnings show here once a statement line matches a song." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Song</TH>
                    <TH>ISRC</TH>
                    <TH className="text-right">Earned</TH>
                    <TH className="text-right">Held for signatures</TH>
                  </TR>
                </THead>
                <TBody>
                  {songs.map((s) => (
                    <TR key={s.songId}>
                      <TD>
                        <Link href={`/songs/${s.songId}`} className="block hover:underline">
                          <span className="block font-medium text-bone">{s.title}</span>
                          <span className="block text-xs text-steel/70">{s.artistName}</span>
                        </Link>
                      </TD>
                      <TD className="font-meta text-xs text-steel">{s.isrc ?? "None"}</TD>
                      <TD className="text-right font-meta text-bone">{amounts(s.earned)}</TD>
                      <TD className="text-right font-meta text-steel">{s.held.length ? amounts(s.held) : "Nothing"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="statements" className="pt-4">
          {statements === undefined ? (
            <SkeletonCards cards={3} />
          ) : statements.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="No statements yet"
              description="Upload your distributor's CSV export to see who is owed what."
              action={<Button onClick={() => setUploadOpen(true)}>Upload statement</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Period</TH>
                    <TH>Source</TH>
                    <TH>File</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {statements.map((s) => (
                    <TR key={s._id}>
                      <TD className="whitespace-nowrap">{period(s.periodStart, s.periodEnd)}</TD>
                      <TD>
                        {SOURCE_LABEL[s.source] ?? s.source}
                        {s.status !== "ready" && (
                          <Badge tone={s.status === "failed" ? "critical" : "info"} className="ml-2">
                            {s.status === "failed" ? "Failed" : "Reading"}
                          </Badge>
                        )}
                      </TD>
                      <TD className="max-w-48 truncate text-steel">{s.fileName}</TD>
                      <TD className="text-right font-meta">{s.rowCount.toLocaleString()}</TD>
                      <TD className="text-right font-meta text-bone">{amounts(s.totals)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <UploadStatementDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <MatchLineDialog line={matching} onClose={() => setMatching(null)} />
      <ContributorSheet
        contributorKey={person}
        name={people?.find((p) => p.key === person)?.name ?? ""}
        statements={statements ?? []}
        onClose={() => setPerson(null)}
      />
    </div>
  );
}
