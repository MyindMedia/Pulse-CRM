"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { QRCodeSVG } from "qrcode.react";
import {
  CalendarDays,
  Check,
  Contact,
  Copy,
  DoorOpen,
  LogIn,
  Plus,
  QrCode,
  UserCheck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { shortDate, timeOfDay, relativeTime } from "@/lib/format";
import { startOfDay } from "@/components/calendar/constants";

/*
 * Visitors - the front-desk guest log. Every registration (QR self check-in
 * from /visit/<slug> or a manual front-desk entry) lands here with its
 * timestamps; the Directory tab is the deduped contact list for outreach.
 * Each visitor is also upserted into Clients as a lead, so the CRM stays the
 * single database.
 */

function stamp(ts: number): string {
  return `${shortDate(ts)} · ${timeOfDay(ts)}`;
}

export default function VisitorsPage() {
  const log = useQuery(api.visitors.list, {});
  const contacts = useQuery(api.visitors.directory, {});
  const org = useQuery(api.orgs.current);
  const checkOut = useMutation(api.visitors.checkOut);

  const [qrOpen, setQrOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // Stable snapshot at mount - stats don't need a live tick.
  const [now] = useState(() => Date.now());
  const todayStart = startOfDay(now);
  const monthStart = useMemo(() => {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, [now]);

  const inStudio = (log ?? []).filter((v) => !v.checkOutAt && v.checkInAt >= todayStart);
  const todayCount = (log ?? []).filter((v) => v.checkInAt >= todayStart).length;
  const monthCount = (log ?? []).filter((v) => v.checkInAt >= monthStart).length;

  const loading = log === undefined || contacts === undefined;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Front desk"
        title="Visitors"
        description="Every guest check-in with its timestamps - and the contact database it builds for clients and outreach."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setQrOpen(true)}>
              <QrCode className="size-4" />
              Check-in QR
            </Button>
            <Button onClick={() => setLogOpen(true)}>
              <Plus className="size-4" />
              Log visitor
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="In studio now" value={inStudio.length} icon={DoorOpen} accent={inStudio.length > 0} />
        <StatTile label="Today" value={todayCount} icon={LogIn} />
        <StatTile label="This month" value={monthCount} icon={CalendarDays} />
        <StatTile label="Contacts collected" value={contacts?.length ?? 0} icon={Contact} />
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="log">
          <TabsList>
            <TabsTrigger value="log">Visit log</TabsTrigger>
            <TabsTrigger value="directory">Directory</TabsTrigger>
          </TabsList>

          {/* ── Visit log - one row per check-in, newest first ── */}
          <TabsContent value="log" className="mt-4">
            {log.length === 0 ? (
              <EmptyState
                icon={UserCheck}
                title="No visitors yet"
                description="Put the check-in QR at the front desk - guests scan it, enter their details and appear here the moment they check in."
                action={
                  <Button onClick={() => setQrOpen(true)}>
                    <QrCode className="size-4" />
                    Show check-in QR
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-graphite/50 bg-coal">
                <Table>
                  <THead>
                    <TR>
                      <TH>Visitor</TH>
                      <TH>Visit</TH>
                      <TH>Checked in</TH>
                      <TH>Checked out</TH>
                      <TH className="text-right">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {log.map((v) => (
                      <TR key={v._id}>
                        <TD>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={v.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-bone">{v.name}</p>
                              <p className="truncate text-xs text-steel/70">
                                {v.email}
                                {v.phone ? ` · ${v.phone}` : ""}
                              </p>
                            </div>
                          </div>
                        </TD>
                        <TD>
                          <p className="text-sm text-bone">{v.purpose || "-"}</p>
                          {v.hostName && (
                            <p className="text-xs text-steel/70">Here to see {v.hostName}</p>
                          )}
                        </TD>
                        <TD>
                          <p className="font-meta text-xs text-bone">{stamp(v.checkInAt)}</p>
                          <p className="text-xs text-steel/70">{relativeTime(v.checkInAt)}</p>
                        </TD>
                        <TD>
                          {v.checkOutAt ? (
                            <p className="font-meta text-xs text-bone">{stamp(v.checkOutAt)}</p>
                          ) : (
                            <span className="text-xs text-steel/50">-</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          {v.checkOutAt ? (
                            <Badge tone="neutral">Departed</Badge>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <Badge tone="gold" dot>
                                In studio
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => checkOut({ id: v._id as Id<"visitors"> })}
                              >
                                Check out
                              </Button>
                            </div>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Directory - the deduped outreach database ── */}
          <TabsContent value="directory" className="mt-4">
            {contacts.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No contacts yet"
                description="Each unique visitor becomes an outreach contact here, and lands in Clients as a lead."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-graphite/50 bg-coal">
                <Table>
                  <THead>
                    <TR>
                      <TH>Contact</TH>
                      <TH>Phone</TH>
                      <TH>Visits</TH>
                      <TH>First visit</TH>
                      <TH>Last visit</TH>
                      <TH className="text-right">Client record</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {contacts.map((c) => (
                      <TR key={c.email}>
                        <TD>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-bone">{c.name}</p>
                              <p className="truncate text-xs text-steel/70">{c.email}</p>
                            </div>
                          </div>
                        </TD>
                        <TD className="text-sm text-bone">{c.phone || "-"}</TD>
                        <TD>
                          <Badge tone={c.visitCount > 1 ? "gold" : "neutral"}>
                            {c.visitCount} {c.visitCount === 1 ? "visit" : "visits"}
                          </Badge>
                        </TD>
                        <TD className="font-meta text-xs text-steel/70">{shortDate(c.firstVisitAt)}</TD>
                        <TD className="font-meta text-xs text-bone">{shortDate(c.lastVisitAt)}</TD>
                        <TD className="text-right">
                          {c.artistId ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/roster/${c.artistId}`}>Open in Clients</Link>
                            </Button>
                          ) : (
                            <span className="text-xs text-steel/50">-</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <CheckInQrDialog open={qrOpen} onOpenChange={setQrOpen} slug={org?.slug} />
      <LogVisitorDialog open={logOpen} onOpenChange={setLogOpen} />
    </div>
  );
}

/** The printable / scannable QR that points guests at /visit/<slug>. */
function CheckInQrDialog({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug?: string;
}) {
  const [copied, setCopied] = useState(false);
  const visitUrl =
    typeof window !== "undefined" && slug ? `${window.location.origin}/visit/${slug}` : "";

  async function copy() {
    if (!visitUrl) return;
    await navigator.clipboard.writeText(visitUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Visitor check-in QR</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-steel/70">
            Print this or frame it at the front desk. Guests scan it, enter their email and visit
            details, and land in the visit log instantly.
          </p>
          {visitUrl ? (
            <div className="mx-auto w-fit rounded-lg bg-white p-4">
              <QRCodeSVG value={visitUrl} size={208} bgColor="#ffffff" fgColor="#0a0a0a" level="M" />
            </div>
          ) : (
            <Skeleton className="mx-auto size-52" />
          )}
          {visitUrl && (
            <p className="break-all text-center font-meta text-xs text-steel/70">{visitUrl}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" className="w-full" onClick={copy} disabled={!visitUrl}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manual front-desk entry - same flow as the QR, keyed in by staff. */
function LogVisitorDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const register = useMutation(api.visitors.registerManual);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [hostName, setHostName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        name,
        email,
        phone: phone || undefined,
        purpose: purpose || undefined,
        hostName: hostName || undefined,
      });
      setName("");
      setEmail("");
      setPhone("");
      setPurpose("");
      setHostName("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong - try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Log a visitor</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Name" htmlFor="v-name">
              <Input id="v-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Email" htmlFor="v-email">
              <Input
                id="v-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Phone (optional)" htmlFor="v-phone">
              <Input id="v-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="Reason for visit (optional)" htmlFor="v-purpose">
              <Textarea
                id="v-purpose"
                rows={2}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </Field>
            <Field label="Here to see (optional)" htmlFor="v-host">
              <Input id="v-host" value={hostName} onChange={(e) => setHostName(e.target.value)} />
            </Field>
            {error && <p className="text-sm text-critical">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={busy}>
              <UserCheck className="size-4" />
              Check in visitor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
