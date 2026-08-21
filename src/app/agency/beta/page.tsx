"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Send, Copy, Ban, MailCheck, Eye, MousePointerClick, PenLine,
  Building2, AlertTriangle, ArrowLeft, FileSignature, MailOpen, LogIn,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* Beta invite dashboard.

   One code per recipient is what makes this a CRM rather than a mailing list:
   every stage below is attributable to a named person, so "we sent it to
   forty studios" becomes "eleven opened it, six signed, and two built a
   studio" - and the gap between two stages is a list of people to call. */

const TONE = {
  created: "neutral",
  sent: "info",
  viewed: "caution",
  signed: "positive",
  claimed: "positive",
  revoked: "neutral",
  expired: "neutral",
} as const;

const STAGES = [
  { key: "sent", label: "Sent", icon: MailCheck },
  { key: "opened", label: "Opened", icon: Eye },
  { key: "clicked", label: "Clicked the link", icon: MousePointerClick },
  { key: "signed", label: "Signed the NDA", icon: PenLine },
  { key: "claimed", label: "Built a studio", icon: Building2 },
] as const;

export default function BetaDashboardPage() {
  const data = useQuery(api.betaAccess.list);
  const invite = useAction(api.betaAccess.invite);
  const revoke = useMutation(api.betaAccess.revoke);

  const [form, setForm] = React.useState({ email: "", name: "", company: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<
    "all" | "silent" | "stalled" | "unsigned" | "signed" | "claimed"
  >("all");

  async function send(sendEmail: boolean) {
    if (!form.email.includes("@")) return toast.error("Enter an email address first.");
    setBusy(true);
    try {
      const res = await invite({
        email: form.email,
        name: form.name || undefined,
        company: form.company || undefined,
        note: form.note || undefined,
        send: sendEmail,
      });
      const how =
        res.emailStatus === "sent" ? "Invite emailed."
        : res.emailStatus === "simulated" ? "Code created. Email is not configured, so nothing sent."
        : res.emailStatus === "not_sent" ? "Code created. Nothing emailed."
        : "Code created, but the email failed to send.";
      toast.success(`${how} Code ${res.code}${res.reused ? " (existing)" : ""}.`);
      setForm({ email: "", name: "", company: "", note: "" });
    } catch (e) {
      const d = (e as { data?: string | { message?: string } })?.data;
      toast.error(typeof d === "string" ? d : d?.message ?? "Could not create that invite.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(code: string) {
    const url = `${window.location.origin}/preview?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Magic link copied.");
    } catch {
      toast.error(`Could not copy. The link is /preview?code=${code}`);
    }
  }

  const counts = data?.counts;
  const rates = data?.rates;

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    if (filter === "all") return items;
    if (filter === "silent") return items.filter((i) => i.sentAt && i.viewCount === 0 && i.status !== "revoked");
    if (filter === "stalled") return items.filter((i) => i.viewCount > 0 && !i.signedAt && i.status !== "revoked");
    if (filter === "unsigned") {
      return items.filter((i) => i.status === "claimed" && !i.signedAt);
    }
    if (filter === "signed") return items.filter((i) => i.signedAt);
    return items.filter((i) => i.status === "claimed");
  }, [data?.items, filter]);

  return (
    <div className="space-y-6">
      <Link
        href="/agency"
        className="inline-flex items-center gap-1.5 font-meta text-[0.7rem] uppercase tracking-[0.06em] text-steel transition-colors hover:text-bone"
      >
        <ArrowLeft className="size-3.5" />
        Agency
      </Link>

      <PageHeader
        overline="Early access"
        title="Beta invites"
        description="Every recipient gets their own code. Track who opened it, who signed the agreement, and who went on to build a studio."
      />

      {/* ── The funnel ── */}
      {counts && rates && (
        <Card>
          <CardContent className="pt-5">
            <div className="grid gap-px overflow-hidden rounded-lg bg-graphite/40 sm:grid-cols-5">
              {STAGES.map((s, i) => {
                const n = counts[s.key] ?? 0;
                const prev = i === 0 ? null : counts[STAGES[i - 1].key] ?? 0;
                const dropped = prev !== null ? prev - n : null;
                return (
                  <div key={s.key} className="bg-coal/50 px-3.5 py-3">
                    <span className="flex items-center gap-1.5">
                      <s.icon className="size-3.5 text-steel/60" />
                      <span className="font-meta text-[0.6rem] uppercase tracking-[0.08em] text-steel/60">
                        {s.label}
                      </span>
                    </span>
                    <p className="mt-1 font-mono text-2xl tabular-nums text-bone">{n}</p>
                    {dropped !== null && dropped > 0 && (
                      <p className="mt-0.5 text-[0.625rem] text-steel/50">{dropped} dropped here</p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-steel">
              <Rate label="Open rate" value={rates.openRate} />
              <Rate label="Sign rate" value={rates.signRate} />
              <Rate label="Claim rate" value={rates.claimRate} />
              <Rate label="End to end" value={rates.endToEnd} strong />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="invites" className="space-y-5">
        <TabsList>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="signatures">
            Signatures{data?.signatures?.length ? ` (${data.signatures.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invites" className="space-y-5">
          {/* ── Send ── */}
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="font-grotesk text-sm font-semibold text-bone">Invite a studio</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  ["email", "Email", "email"],
                  ["name", "Their name", "text"],
                  ["company", "Studio name", "text"],
                  ["note", "Private note (how you know them)", "text"],
                ] as const).map(([key, placeholder, type]) => (
                  <input
                    key={key}
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    className="rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => send(true)}>
                  <Send className="mr-1.5 size-3.5" />
                  {busy ? "Sending…" : "Send invite"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(false)}>
                  Create code only
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Who needs chasing ── */}
          <div className="flex flex-wrap gap-2">
            {([
              ["all", `Everyone${counts ? ` (${counts.total})` : ""}`],
              ["silent", `Sent, never opened${counts ? ` (${counts.silent})` : ""}`],
              ["stalled", `Opened, never signed${counts ? ` (${counts.stalled})` : ""}`],
              ["unsigned", `Using it, unsigned${counts ? ` (${counts.unsigned})` : ""}`],
              ["signed", `Signed${counts ? ` (${counts.signed})` : ""}`],
              ["claimed", `Built a studio${counts ? ` (${counts.claimed})` : ""}`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-meta text-[0.65rem] uppercase tracking-[0.06em] transition-colors",
                  filter === key
                    ? "border-gold bg-gold/12 text-bone"
                    : "border-graphite/60 text-steel hover:border-graphite hover:text-bone",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <Card>
              <CardContent className="pt-5">
                <p className="py-6 text-center text-sm text-steel">
                  {filter === "all" ? "No invites yet." : "Nobody in this group right now."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((i) => (
                <li
                  key={i._id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3.5 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-bone">{i.name || i.email}</span>
                      <Badge tone={TONE[i.status]}>{i.status}</Badge>
                      {i.company && <span className="text-xs text-steel/70">{i.company}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem] text-steel/70">
                      <span className="font-mono text-gold/80">{i.code}</span>
                      {i.sentAt && (
                        <Meta icon={MailCheck} label={new Date(i.sentAt).toLocaleDateString()} />
                      )}
                      {/* Email opens are best-effort: image blocking means a
                          missing open proves nothing, so it is only ever shown
                          as a positive signal, never as a rejection. */}
                      {i.emailOpenedAt && (
                        <Meta icon={MailOpen} label={`email opened${(i.emailOpenCount ?? 0) > 1 ? ` ${i.emailOpenCount}x` : ""}`} />
                      )}
                      {i.clickedAt && <Meta icon={MousePointerClick} label="clicked the link" />}
                      {i.viewCount > 0 && <Meta icon={Eye} label={`${i.viewCount} page open${i.viewCount === 1 ? "" : "s"}`} />}
                      {i.lastLoginAt && (
                        <span className="flex items-center gap-1 text-gold">
                          <LogIn className="size-3" />
                          last login {new Date(i.lastLoginAt).toLocaleDateString()}
                          {(i.loginCount ?? 0) > 1 ? ` (${i.loginCount})` : ""}
                        </span>
                      )}
                      {i.signedAt && (
                        <span className="flex items-center gap-1 text-positive">
                          <PenLine className="size-3" />
                          {i.signedName} · {new Date(i.signedAt).toLocaleDateString()}
                        </span>
                      )}
                      {i.claimedSlug && (
                        <Link
                          href={`/book/${i.claimedSlug}`}
                          className="flex items-center gap-1 text-gold underline-offset-2 hover:underline"
                        >
                          <Building2 className="size-3" />
                          /{i.claimedSlug}
                        </Link>
                      )}
                      {i.note && <span className="italic text-steel/50">{i.note}</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => copyLink(i.code)} aria-label={`Copy the magic link for ${i.email}`}>
                      <Copy className="size-3.5" />
                    </Button>
                    {i.status !== "revoked" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await revoke({ id: i._id as Id<"betaInvites"> });
                            toast.success("Access withdrawn. The signature stays on the record.");
                          } catch {
                            toast.error("Could not revoke that.");
                          }
                        }}
                        aria-label={`Revoke access for ${i.email}`}
                      >
                        <Ban className="size-3.5" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ── The signature register ── */}
        <TabsContent value="signatures">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
                  <FileSignature className="size-4" />
                </span>
                <div>
                  <p className="font-grotesk text-sm font-semibold text-bone">Signature register</p>
                  <p className="text-xs text-steel">
                    Who agreed to what, and when. Each signature is bound to a hash of the exact
                    terms that were on screen, so an edit to the agreement cannot be passed off
                    as what somebody signed. Current version {data?.currentNdaVersion}.
                  </p>
                </div>
              </div>

              {!data?.signatures?.length ? (
                <p className="py-6 text-center text-sm text-steel">Nobody has signed yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.signatures.map((sig) => (
                    <li
                      key={sig.id}
                      className="rounded-md border border-graphite/50 bg-coal-2 px-3.5 py-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-[cursive] text-lg text-bone">{sig.name}</span>
                        <span className="font-mono text-xs tabular-nums text-steel">
                          {new Date(sig.signedAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-steel/70">
                        {[sig.title, sig.company, sig.email].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[0.65rem] text-steel/50">
                        <span>v{sig.ndaVersion}</span>
                        {sig.termsHash && <span>{sig.termsHash}</span>}
                        {sig.staleTerms && (
                          <span className="flex items-center gap-1 text-caution">
                            <AlertTriangle className="size-3" />
                            signed against an older version
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Rate({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-steel/70">{label}</span>
      <b className={cn("font-mono tabular-nums", strong ? "text-gold" : "text-bone")}>{value}%</b>
    </span>
  );
}

function Meta({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Icon className="size-3" />
      {label}
    </span>
  );
}
