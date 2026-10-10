import { v, ConvexError } from "convex/values";
import { query, internalQuery, internalAction } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";
import { currentOrgWithCapability } from "./lib/tenant";
import { parsePeriod, periodKeyOf } from "./lib/ledgerMath";
import {
  ACCOUNTING_AGENT,
  agentMay,
  assertActionInScope,
  isAccountingType,
  plain,
} from "./lib/agentScope";
import {
  type AccountingSignals,
  type AcctEntry,
  accountingCandidates,
  accountingInsights,
  anomalyCandidates,
  closeChecklist,
  dollars,
  ownerDigest,
  periodLabel,
} from "./agents/accounting";
import type { ProposedAction } from "./opsBrain";
import { attachReceipt, createEntry, lateEntryWriter, ledgerPeriodView, postDraft, recordLateEntry, writeOrg } from "./ledger";

/* ============================================================
   Accounting agent - the scan, the approvals, the on/off switch.

   The one agent that works on the studio's money. Its pure rules live in
   convex/agents/accounting.ts; what it may and may not do is data in
   convex/lib/agentScope.ts. This module is the only one besides ledger.ts
   that touches the books on an agent's behalf:

   - scan: read the books, propose. The only writes are DRAFT journal
     entries (source "agent"), proposal rows in opsActions, read-only
     insights and a run log. It never posts, voids, edits or deletes.
   - approve: a person with the owner or manager seat approves, and only
     then does `postDraft` run (the same ledger API the Books screen uses).
   - autonomy: even "auto_trusted" may only attach an exact receipt match.

   Spec: openspec/changes/accounting-agent/.
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

const AGENT_ACTOR = "Accounting agent";
const RESCAN_ACTOR = "accounting:rescan";
const SCAN_PERIODS = 2;
const PRIOR_MONTHS = 3;

/* ── Gathering ───────────────────────────────────────────────── */

function toAcctEntry(d: Doc<"journalEntries">): AcctEntry {
  return {
    id: d._id,
    entryDate: d.entryDate,
    memo: d.memo,
    status: d.status,
    source: d.source,
    receiptStatus: d.receiptStatus,
    paymentKind: d.paymentType?.kind,
    paymentRaw: d.paymentType?.raw,
    bookPeriod: d.bookPeriod,
    sourceRef: d.sourceRef,
    lines: d.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })),
    totalCents: d.totalCents,
    receiptIds: (d.receiptDocIds ?? []).map(String),
  };
}

/** Months that have books, newest first, capped. An explicit period wins. */
async function periodsToScan(ctx: Ctx, orgId: string, explicit?: string): Promise<string[]> {
  if (explicit) return [parsePeriod(explicit).key];
  const [reported, bank, last] = await Promise.all([
    ctx.db.query("reportedStatements").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(200),
    ctx.db.query("bankStatementBalances").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(200),
    ctx.db.query("journalEntries").withIndex("by_org_date", (q) => q.eq("orgId", orgId)).order("desc").first(),
  ]);
  const keys = new Set<string>();
  for (const r of reported) keys.add(periodKeyOf(r.periodStart));
  for (const b of bank) keys.add(periodKeyOf(b.periodStart));
  if (last) keys.add(last.bookPeriod ?? periodKeyOf(last.entryDate));
  return [...keys].sort().reverse().slice(0, SCAN_PERIODS);
}

export async function gatherAccountingSignals(ctx: Ctx, orgId: string, periodKey: string, now: number): Promise<AccountingSignals> {
  const view = await ledgerPeriodView(ctx, orgId, periodKey);
  const { period } = view;
  const entries = view.entryDocs
    .filter((e) => e.status !== "void" && ((e.entryDate >= period.start && e.entryDate < period.end) || e.bookPeriod === period.key))
    .map(toAcctEntry);

  const prior: AccountingSignals["prior"] = [];
  let cursor = period.start;
  for (let i = 0; i < PRIOR_MONTHS; i++) {
    const p = parsePeriod(periodKeyOf(cursor - 1));
    const rows = await ctx.db
      .query("journalEntries")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("entryDate", p.start).lt("entryDate", p.end))
      .take(5_000);
    prior.push({ key: p.key, entries: rows.filter((e) => e.status === "posted").map(toAcctEntry) });
    cursor = p.start;
  }

  const receipts = await ctx.db
    .query("receipts")
    .withIndex("by_org_uploaded", (q) => q.eq("orgId", orgId))
    .order("desc")
    .take(300);

  // The bank feed for the month, for money the books never recorded.
  const feed = await ctx.db
    .query("bankTransactions")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", period.start).lt("date", period.end))
    .take(2_000);
  const feedAccounts = new Map<string, Doc<"bankAccounts"> | null>();
  for (const t of feed) {
    if (!feedAccounts.has(t.accountId)) feedAccounts.set(t.accountId, await ctx.db.get(t.accountId));
  }
  const bankLines = feed
    .filter((t) => !t.pending && !t.removed && !t.excluded)
    .map((t) => ({
      id: t._id, date: t.date, amountCents: t.amountCents, direction: t.direction, name: t.merchantName ?? t.name,
      ...(t.category ? { category: t.category } : {}),
      ...(feedAccounts.get(t.accountId)?.type === "credit" ? { onCard: true } : {}),
      ...(t.receiptId ? { receiptId: t.receiptId } : {}),
    }));

  const late = view.built.lateEntries;

  const v = view.built.variances;
  const recomputed = view.built.recomputed;
  return {
    now,
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    accounts: view.accountDocs.map((a) => ({ id: a._id, key: a.key, name: a.name, type: a.type, isCash: a.isCash, isClearing: a.isClearing })),
    entries,
    prior,
    receipts: receipts.map((r) => ({ id: r._id, vendor: r.vendor, date: r.date, totalCents: r.totalCents, status: r.status, ...(r.cardLast4 ? { cardLast4: r.cardLast4 } : {}) })),
    bankLines,
    lateImpact: late
      ? {
          count: late.count,
          before: { netIncomeCents: late.before.netIncomeCents, endingCashCents: late.before.endingCashCents },
          after: { netIncomeCents: late.after.netIncomeCents, endingCashCents: late.after.endingCashCents },
          entries: late.entries.map((e) => ({ memo: e.memo, totalCents: e.totalCents, enteredAt: e.enteredAt, reversal: !!e.reversalOf })),
        }
      : null,
    recon: view.recon,
    checks: view.built.checks,
    variances: v
      ? [...v.incomeStatement, ...v.balanceSheet, ...v.cashFlow].map((x) => ({
          statement: x.statement, key: x.key, label: x.label, kind: x.kind,
          reportedCents: x.reportedCents, recomputedCents: x.recomputedCents, varianceCents: x.varianceCents,
        }))
      : [],
    warnings: (view.reportedDoc?.warnings ?? []).map((w) => ({
      code: w.code, severity: w.severity, message: w.message, row: w.row, raw: w.raw, normalized: w.normalized,
    })),
    hasReported: !!view.reportedDoc,
    totals: {
      revenueCents: recomputed.incomeStatement.totalRevenueCents,
      expensesCents: recomputed.incomeStatement.totalExpensesCents,
      netIncomeCents: recomputed.incomeStatement.netIncomeCents,
      endingCashCents: recomputed.cashFlow.endingCashCents,
    },
  };
}

/* ── Policy ──────────────────────────────────────────────────── */

type Autonomy = "suggest" | "auto_low" | "auto_trusted";

async function policyFor(ctx: Ctx, orgId: string): Promise<{ on: boolean; autonomy: Autonomy }> {
  const row = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  return {
    on: (row?.enabled ?? true) && (row?.accountingEnabled ?? true),
    autonomy: row?.autonomy ?? "suggest",
  };
}

/** Is the Accounting agent switched on for this studio? */
export async function accountingIsOn(ctx: Ctx, orgId: string): Promise<boolean> {
  return (await policyFor(ctx, orgId)).on;
}

/** Terminal statuses block a re-proposal too: a dismissed or already-applied
 *  proposal must not come back on the next scan. A changed situation gets a
 *  new key (the amounts are in it), so it is proposed afresh. */
const BLOCKING = new Set(["proposed", "approved", "snoozed", "executing", "executed", "dismissed"]);

async function insertProposal(
  ctx: MutationCtx,
  orgId: string,
  c: ProposedAction,
  accountIdByKey: Map<string, Id<"ledgerAccounts">>,
  autonomy: Autonomy,
): Promise<{ id: Id<"opsActions">; auto: boolean } | null> {
  assertActionInScope("accounting", c);
  const dedupeKey = `${c.type}:${c.entityId ?? "org"}`;
  const existing = await ctx.db
    .query("opsActions")
    .withIndex("by_org_dedupe", (q) => q.eq("orgId", orgId).eq("dedupeKey", dedupeKey))
    .collect();
  // A proposal the rescan itself withdrew may come back if the situation does.
  if (existing.some((r) => BLOCKING.has(r.status) && !(r.status === "dismissed" && r.decidedBy === RESCAN_ACTOR))) return null;

  const now = Date.now();
  let payload = c.payload;
  if (payload.kind === "ledger_draft") {
    // The draft journal entry is the proposal. Its sourceRef is the dedupe key,
    // so a lost opsActions row can never produce a second draft.
    const sourceRef = `agent:${dedupeKey}`;
    const found = await ctx.db
      .query("journalEntries")
      .withIndex("by_org_source_ref", (q) => q.eq("orgId", orgId).eq("sourceRef", sourceRef))
      .first();
    const draftId = found?._id ?? await createEntry(ctx, orgId, AGENT_ACTOR, {
      entryDate: payload.entryDate,
      memo: payload.memo,
      status: "draft",
      source: "agent",
      sourceRef,
      lines: payload.lines.map((l) => {
        const accountId = accountIdByKey.get(l.accountKey);
        if (!accountId) throw new Error(`Account ${l.accountKey} is not in this studio's chart.`);
        return { accountId, debitCents: l.debitCents, creditCents: l.creditCents, ...(l.memo ? { memo: l.memo } : {}) };
      }),
    });
    payload = { ...payload, draftEntryId: draftId };
  }

  // The only thing autonomy ever lets the agent apply by itself: an exact
  // receipt match. Everything else, at every autonomy level, waits for a person.
  const auto =
    autonomy === "auto_trusted" &&
    c.type === "acct_receipt_link" &&
    payload.kind === "receipt_link" &&
    payload.exact &&
    agentMay("accounting", "receipts.link_exact");
  if (auto && payload.kind === "receipt_link") {
    await attachReceipt(ctx, orgId, payload.entryId, payload.receiptId);
  }

  const id = await ctx.db.insert("opsActions", {
    orgId,
    type: c.type as Doc<"opsActions">["type"],
    priority: c.priority,
    title: plain(c.title),
    rationale: plain(c.rationale),
    entityType: c.entityType,
    entityId: c.entityId,
    ...(c.riskLevel ? { riskLevel: c.riskLevel } : {}),
    ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
    payload: payload as Doc<"opsActions">["payload"],
    status: auto ? "executed" : "proposed",
    autonomy: auto,
    source: "rule",
    dedupeKey,
    createdAt: now,
    ...(auto ? { decidedAt: now, decidedBy: "accounting:auto_trusted", executedAt: now, result: "Receipt linked automatically (exact match)." } : {}),
  });
  await ctx.db.insert("agentAuditLogs", {
    orgId,
    event: auto ? "accounting.receipt_linked_auto" : "accounting.proposed",
    detail: `${c.type}: ${plain(c.title)}`,
    actor: AGENT_ACTOR,
    at: now,
  });
  return { id, auto };
}

async function upsertInsight(ctx: MutationCtx, orgId: string, runId: Id<"agentRuns">, ins: { title: string; severity: "info" | "warning"; explanation: string }) {
  const same = await ctx.db.query("agentInsights").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const matches = same.filter((i) => i.title === ins.title);
  const active = matches.find((i) => i.status === "active");
  if (active) {
    if (active.explanation !== ins.explanation || active.severity !== ins.severity) {
      await ctx.db.patch(active._id, { explanation: ins.explanation, severity: ins.severity });
      return "updated" as const;
    }
    return "same" as const;
  }
  if (matches.some((i) => i.explanation === ins.explanation)) return "same" as const; // dismissed, unchanged
  await ctx.db.insert("agentInsights", { orgId, runId, title: ins.title, severity: ins.severity, explanation: ins.explanation, status: "active", createdAt: Date.now() });
  return "inserted" as const;
}

/* ── The scan ────────────────────────────────────────────────── */

export type ScanResult = {
  skipped?: "off" | "no_books";
  periods: string[];
  proposed: number;
  autoLinked: number;
  insights: number;
  runId?: Id<"agentRuns">;
};

export async function runAccountingScan(ctx: MutationCtx, orgId: string, opts?: { period?: string }): Promise<ScanResult> {
  const policy = await policyFor(ctx, orgId);
  if (!policy.on) return { skipped: "off", periods: [], proposed: 0, autoLinked: 0, insights: 0 };
  const periods = await periodsToScan(ctx, orgId, opts?.period);
  if (periods.length === 0) return { skipped: "no_books", periods: [], proposed: 0, autoLinked: 0, insights: 0 };

  const now = Date.now();
  const runId = await ctx.db.insert("agentRuns", {
    orgId, initiatedBy: "system", runType: "accounting_scan", status: "running",
    prompt: `Accounting scan: ${periods.join(", ")}`, source: "rule",
  });
  await ctx.db.insert("agentAuditLogs", { orgId, runId, event: "run.created", detail: "accounting scan", actor: AGENT_ACTOR, at: now });

  let proposed = 0;
  let autoLinked = 0;
  let insights = 0;
  const enrichIds: Id<"opsActions">[] = [];
  for (const key of periods) {
    const signals = await gatherAccountingSignals(ctx, orgId, key, now);
    const accountIdByKey = new Map(signals.accounts.map((a) => [a.key, a.id as Id<"ledgerAccounts">] as const));
    const candidates = accountingCandidates(signals);
    const candidatesKeys = candidates.map((c) => `${c.type}:${c.entityId ?? "org"}`);
    for (const c of candidates) {
      const res = await insertProposal(ctx, orgId, c, accountIdByKey, policy.autonomy);
      if (!res) continue;
      proposed++;
      if (res.auto) autoLinked++;
      else enrichIds.push(res.id);
    }
    // Withdraw open items that no longer apply (the person fixed it another
    // way, a receipt arrived, a balance cleared). Never touches a decision.
    const current = new Set(candidatesKeys);
    const open = await ctx.db.query("opsActions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const r of open) {
      if (!isAccountingType(r.type) || (r.status !== "proposed" && r.status !== "snoozed")) continue;
      if (!r.entityId?.startsWith(`${key}:`) || current.has(r.dedupeKey)) continue;
      await ctx.db.patch(r._id, { status: "dismissed", decidedAt: now, decidedBy: RESCAN_ACTOR, result: "No longer applies after a fresh look at the books." });
    }
    for (const ins of accountingInsights(signals)) {
      if ((await upsertInsight(ctx, orgId, runId, ins)) !== "same") insights++;
    }
  }

  const summary = `Accounting scan of ${periods.map(periodLabel).join(" and ")}: ${proposed} new item${proposed === 1 ? "" : "s"} for you${autoLinked ? ` (${autoLinked} exact receipt match${autoLinked === 1 ? "" : "es"} linked automatically)` : ""}, ${insights} note${insights === 1 ? "" : "s"} updated.`;
  await ctx.db.patch(runId, { status: "completed", summary, completedAt: Date.now() });
  await ctx.db.insert("agentAuditLogs", { orgId, runId, event: "run.completed", detail: summary, actor: AGENT_ACTOR, at: Date.now() });

  // Optional AI wording. Only when a model key exists; the deterministic text
  // is already saved, so the product works the same without one.
  if (enrichIds.length > 0 && process.env.OPENAI_API_KEY) {
    await ctx.scheduler.runAfter(0, internal.aiActions.enrichAccountingActions, { ids: enrichIds });
  }
  return { periods, proposed, autoLinked, insights, runId };
}

export const scanOrg = internalMutation({
  args: { orgId: v.string(), period: v.optional(v.string()) },
  handler: async (ctx, { orgId, period }) => runAccountingScan(ctx, orgId, { period }),
});

export const scanAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    const ids = orgs.filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo").map((o) => o.orgId);
    for (const orgId of ids) await ctx.scheduler.runAfter(0, internal.accountingAgent.scanOrg, { orgId });
    return { scheduled: ids.length };
  },
});

/* ── Approvals ───────────────────────────────────────────────── */

/** A clearing draft moves money out of a holding account. Before posting it,
 *  confirm the account still holds at least that much, so approving two drafts
 *  that overlap can never drive the account negative. */
async function assertClearingStillHolds(ctx: MutationCtx, orgId: string, entry: Doc<"journalEntries">) {
  const accounts = await ctx.db.query("ledgerAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const byId = new Map(accounts.map((a) => [a._id, a] as const));
  const out = entry.lines.find((l) => l.creditCents > 0 && byId.get(l.accountId)?.isClearing);
  if (!out) return;
  const view = await ledgerPeriodView(ctx, orgId, periodKeyOf(entry.entryDate));
  const held = view.recon.flatMap((r) => r.unclearedClearing).find((u) => u.accountId === out.accountId);
  if (!held || held.cents < out.creditCents) {
    throw new ConvexError({ code: "STALE_PROPOSAL", message: "That balance has changed since this draft was made. Run a fresh scan, then review the new draft." });
  }
}

async function loadAccountingAction(ctx: MutationCtx, id: Id<"opsActions">) {
  const { orgId, actor } = await writeOrg(ctx); // insights.read, and an owner or manager seat
  await requireCapability(ctx, "ops.action.approve", { orgId });
  const action = await ctx.db.get(id);
  if (!action || action.orgId !== orgId) throw new Error("Not found");
  if (!isAccountingType(action.type)) throw new Error("That is not an accounting item.");
  return { action, orgId, actor };
}

export async function approveAccountingAction(ctx: MutationCtx, id: Id<"opsActions">) {
  const { action, orgId, actor } = await loadAccountingAction(ctx, id);
  if (action.status !== "proposed" && action.status !== "snoozed") {
    throw new Error(`Cannot approve an action that is ${action.status}`);
  }
  const p = action.payload;
  let result = "Noted.";
  if (p.kind === "ledger_draft") {
    if (!p.draftEntryId) throw new Error("This item has no draft entry. Run a fresh scan.");
    const draft = await ctx.db.get(p.draftEntryId);
    if (!draft || draft.orgId !== orgId) throw new Error("The draft entry is gone. Run a fresh scan.");
    if (draft.status === "posted") {
      result = "Already posted.";
    } else if (draft.status === "draft") {
      if (action.type === "acct_clearing_draft") await assertClearingStillHolds(ctx, orgId, draft);
      await postDraft(ctx, orgId, p.draftEntryId); // only a person's approval gets here
      result = `Posted: ${draft.memo}`;
    } else {
      throw new Error("The draft entry was voided. Run a fresh scan.");
    }
  } else if (p.kind === "receipt_link") {
    await attachReceipt(ctx, orgId, p.entryId, p.receiptId);
    result = "Receipt linked.";
  } else if (p.kind === "acct_note") {
    result = "Acknowledged. Nothing in the books changed.";
  } else if (p.kind === "late_entry") {
    // A late entry changes a month that has ended: the owner's call, through
    // the same path as the Books form. Approving is the confirmation.
    if (!p.accountKey || !p.paidFrom) throw new Error("Open Books to choose the category and how it was paid, then add it there.");
    const who = await lateEntryWriter(ctx);
    const account = await ctx.db.query("ledgerAccounts").withIndex("by_org_key", (q) => q.eq("orgId", orgId).eq("key", p.accountKey!)).first();
    if (!account) throw new Error("That category is no longer in the chart. Open Books to choose one.");
    const out = await recordLateEntry(ctx, who, {
      period: p.period,
      input: {
        kind: p.lateKind, entryDate: p.entryDate, counterparty: p.counterparty, amountCents: p.amountCents,
        accountId: account._id, paidFrom: p.paidFrom, reason: p.reason, ...(p.memo ? { memo: p.memo } : {}),
      },
      ...(p.receiptId ? { receiptId: p.receiptId } : {}),
      confirmPastMonth: true,
      via: "agent",
    });
    result = `Added to ${periodLabel(p.period)} as a late entry. Net income ${dollars(out.before.netIncomeCents)} to ${dollars(out.after.netIncomeCents)}.`;
  } else {
    throw new Error("Unsupported accounting item.");
  }
  const now = Date.now();
  await ctx.db.patch(id, { status: "executed", decidedAt: now, decidedBy: actor, executedAt: now, result });
  await ctx.db.insert("activity", {
    orgId, kind: `ops.${action.type}`, summary: `Accounting: ${action.title}`, actorName: actor,
    entityType: action.entityType, entityId: action.entityId, accent: "gold",
  });
  await ctx.db.insert("auditEvents", {
    orgId, viewerType: "studio_member", viewerId: actor, action: `ops.execute.${action.type}`, resource: id, result: "allow", reason: "approved",
  });
  await ctx.db.insert("agentAuditLogs", { orgId, event: "approval.approved", detail: action.title, actor, at: now });
}

export async function dismissAccountingAction(ctx: MutationCtx, id: Id<"opsActions">) {
  const { action, orgId, actor } = await loadAccountingAction(ctx, id);
  const now = Date.now();
  // The draft entry, if any, stays a draft: dismissing never voids or deletes.
  await ctx.db.patch(id, { status: "dismissed", decidedAt: now, decidedBy: actor });
  await ctx.db.insert("agentAuditLogs", { orgId, event: "approval.dismissed", detail: action.title, actor, at: now });
}

export async function snoozeAccountingAction(ctx: MutationCtx, id: Id<"opsActions">, until: number) {
  const { action, orgId, actor } = await loadAccountingAction(ctx, id);
  await ctx.db.patch(id, { status: "snoozed", snoozeUntil: until });
  await ctx.db.insert("agentAuditLogs", { orgId, event: "approval.snoozed", detail: action.title, actor, at: Date.now() });
}

export const approve = mutation({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => approveAccountingAction(ctx, id),
});

export const dismiss = mutation({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => dismissAccountingAction(ctx, id),
});

export const snooze = mutation({
  args: { id: v.id("opsActions"), until: v.number() },
  handler: async (ctx, { id, until }) => snoozeAccountingAction(ctx, id, until),
});

/* ── Who may see accounting items ────────────────────────────── */

/** True when the caller may see the studio's money. The shared inbox hides
 *  accounting items from everyone else. */
export async function viewerMaySeeMoney(ctx: Ctx): Promise<boolean> {
  try {
    const viewer = await resolveViewer(ctx);
    return viewer.kind !== "guest" && viewer.capabilities.has("insights.read");
  } catch {
    return false;
  }
}

/* ── On / off ────────────────────────────────────────────────── */

export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const policy = await policyFor(ctx, orgId);
    const open = (await ctx.db.query("opsActions").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "proposed")).collect())
      .filter((r) => isAccountingType(r.type)).length;
    const lastRun = (await ctx.db.query("agentRuns").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(50))
      .find((r) => r.runType === "accounting_scan");
    return {
      agent: ACCOUNTING_AGENT.name,
      enabled: policy.on,
      autonomy: policy.autonomy,
      openProposals: open,
      lastScanAt: lastRun?._creationTime ?? null,
    };
  },
});

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    // A switch, not an autonomy setting: an owner or manager seat is enough.
    const { orgId, actor } = await writeOrg(ctx);
    await setAccountingEnabled(ctx, orgId, enabled, actor);
  },
});

export async function setAccountingEnabled(ctx: MutationCtx, orgId: string, enabled: boolean, actor: string) {
  const row = await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (row) await ctx.db.patch(row._id, { accountingEnabled: enabled, updatedAt: Date.now() });
  else {
    await ctx.db.insert("agentPolicies", {
      orgId, enabled: true, defaultTone: "professional", autonomy: "suggest",
      digestEnabled: true, digestHourLocal: 8, accountingEnabled: enabled, updatedAt: Date.now(),
    });
  }
  await ctx.db.insert("agentAuditLogs", { orgId, event: enabled ? "accounting.enabled" : "accounting.disabled", actor, at: Date.now() });
}

/* ── The picture, on demand ──────────────────────────────────── */

/** The close checklist and the owner digest for a month, computed live. */
export const overview = query({
  args: { period: v.optional(v.string()) },
  handler: async (ctx, { period }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const keys = await periodsToScan(ctx, orgId, period);
    if (keys.length === 0) return null;
    const signals = await gatherAccountingSignals(ctx, orgId, keys[0], Date.now());
    const items = closeChecklist(signals);
    const digest = ownerDigest(signals, items, anomalyCandidates(signals));
    return { period: keys[0], label: periodLabel(keys[0]), digest, checklist: items };
  },
});

/* ── Money questions routed here ─────────────────────────────── */

export const _answerFor = internalQuery({
  args: { orgId: v.string(), prompt: v.string() },
  handler: async (ctx, { orgId, prompt }) => {
    const keys = await periodsToScan(ctx, orgId);
    if (keys.length === 0) {
      return plain("There are no books in Pulse for this studio yet, so there is nothing for me to look at. Once the books are imported I can match receipts, check cash against the bank and tell you where the month stands.");
    }
    const signals = await gatherAccountingSignals(ctx, orgId, keys[0], Date.now());
    const items = closeChecklist(signals);
    const digest = ownerDigest(signals, items, anomalyCandidates(signals));
    const q = prompt.toLowerCase();
    const pick = (re: RegExp, groups: string[]) => (re.test(q) ? items.filter((i) => groups.includes(i.group)) : []);
    const focus = [
      ...pick(/receipt/, ["receipts"]),
      ...pick(/bank|cash|reconcil|deposit|transit|draw/, ["cash"]),
      ...pick(/close|month[- ]end|checklist|left to do/, ["statements", "cash", "receipts", "recurring", "tidy"]),
      ...pick(/statement|p&l|profit|loss|income|books/, ["statements"]),
      ...pick(/recurring|rent|insurance|internet|software|regular/, ["recurring"]),
    ];
    const seen = new Set<string>();
    const lines = focus.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).flatMap((i) => [`${i.label}:`, ...i.details.map((d) => `- ${d}`)]);
    const body = lines.length ? lines : digest.bullets.map((b) => `- ${b}`);
    return plain([`${periodLabel(keys[0])}. ${digest.headline}`, ...body, "I only draft changes. Nothing goes into the books until you approve it in the Approval Inbox."].join("\n"));
  },
});

export const answerRun = internalAction({
  args: { runId: v.id("agentRuns"), orgId: v.string(), prompt: v.string() },
  handler: async (ctx, { runId, orgId, prompt }) => {
    try {
      const text: string = await ctx.runQuery(internal.accountingAgent._answerFor, { orgId, prompt });
      await ctx.runMutation(internal.agent._finalize, {
        runId, orgId, status: "completed", summary: text.split("\n")[0].slice(0, 280), assistant: text, source: "accounting",
      });
    } catch (err) {
      await ctx.runMutation(internal.agent._finalize, {
        runId, orgId, status: "failed", error: err instanceof Error ? err.message : "accounting answer failed",
      });
    }
  },
});

/* ── AI wording (optional) ───────────────────────────────────── */

export const wordingContext = internalQuery({
  args: { id: v.id("opsActions") },
  handler: async (ctx, { id }) => {
    const a = await ctx.db.get(id);
    if (!a || !isAccountingType(a.type) || (a.status !== "proposed" && a.status !== "snoozed")) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", a.orgId)).first();
    const evidence = a.payload.kind === "ledger_draft" || a.payload.kind === "receipt_link" || a.payload.kind === "acct_note" || a.payload.kind === "late_entry" ? a.payload.evidence : [];
    return { orgId: a.orgId, orgName: org?.name ?? "the studio", type: a.type, title: a.title, rationale: a.rationale, evidence };
  },
});
