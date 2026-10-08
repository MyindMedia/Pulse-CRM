import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  ACCOUNTING_ACTION_TYPES,
  ACCOUNTING_CAPABILITIES,
  ACCOUNTING_FORBIDDEN,
  ACTION_CAPABILITY,
  AGENT_OF_ACTION_TYPE,
  LEDGER_PAYLOAD_KINDS,
  ScopeError,
  agentMay,
  agentOfActionType,
  assertActionInScope,
  isAccountingType,
  plain,
  routeIntent,
} from "./agentScope";
import {
  leadCandidates,
  prepCandidates,
  recapCandidates,
  revisionTriageCandidates,
  pricingCandidates,
  noShowCandidates,
  weakLeadSourceCandidates,
} from "../agents/generators";
import { candidatesFor, type ProposedAction, type Signals } from "../opsBrain";
import { riskFlagCandidates } from "../risk";
import { profitLeverCandidates } from "../profitability";

/* Scope enforcement for the Accounting agent (openspec accounting-agent):
   (a) its generators emit only money action kinds, (b) no other agent can
   emit a ledger action or touch the ledger, (c) a money question reaches it. */

const NOW = Date.UTC(2026, 9, 8);
const DAY = 86_400_000;

describe("the Accounting agent's allowlist", () => {
  it("is declarative, and the forbidden list never overlaps it", () => {
    for (const f of ACCOUNTING_FORBIDDEN) expect(ACCOUNTING_CAPABILITIES as readonly string[]).not.toContain(f);
    for (const f of ["ledger.post", "ledger.void", "ledger.edit_posted", "ledger.delete", "money.move", "email.send", "sms.send", "bookings.write", "rates.write", "members.write", "settings.write"]) {
      expect(ACCOUNTING_FORBIDDEN as readonly string[]).toContain(f);
      expect(agentMay("accounting", f)).toBe(false);
    }
    for (const c of ["ledger.read", "ledger.draft_entry", "receipts.propose_link", "categories.propose", "bank.read", "expenses.read", "receipts.read"]) {
      expect(agentMay("accounting", c)).toBe(true);
    }
  });

  it("gives every accounting action kind a capability that is on the allowlist", () => {
    for (const t of ACCOUNTING_ACTION_TYPES) {
      expect(ACCOUNTING_CAPABILITIES as readonly string[]).toContain(ACTION_CAPABILITY[t]);
      expect(agentOfActionType(t)).toBe("accounting");
    }
  });

  it("no other agent holds a single ledger capability", () => {
    for (const agent of ["booking_conversion", "session_prep", "post_session_recap", "revision_triage", "rights_splits", "revenue_ops", "operations", "marketing"] as const) {
      for (const c of [...ACCOUNTING_CAPABILITIES, ...ACCOUNTING_FORBIDDEN]) expect(agentMay(agent, c)).toBe(false);
    }
  });

  it("owns exactly the eight accounting kinds in the inbox map", () => {
    const owned = Object.entries(AGENT_OF_ACTION_TYPE).filter(([, a]) => a === "accounting").map(([t]) => t).sort();
    expect(owned).toEqual([...ACCOUNTING_ACTION_TYPES].sort());
    expect(isAccountingType("convert_lead")).toBe(false);
  });
});

describe("assertActionInScope", () => {
  const draft: ProposedAction = {
    type: "acct_clearing_draft", priority: "high", title: "t", rationale: "r",
    payload: {
      kind: "ledger_draft", entryDate: NOW, memo: "m", evidence: [], cashEffectCents: 100,
      lines: [
        { accountKey: "bank_cash", accountName: "Bank / Cash", debitCents: 100, creditCents: 0 },
        { accountKey: "deposits_in_transit", accountName: "Deposits In Transit", debitCents: 0, creditCents: 100 },
      ],
    },
  };

  it("lets Accounting propose a balanced draft and nobody else", () => {
    expect(() => assertActionInScope("accounting", draft)).not.toThrow();
    for (const agent of ["revenue_ops", "operations", "booking_conversion", "marketing"] as const) {
      expect(() => assertActionInScope(agent, draft)).toThrow(ScopeError);
    }
  });

  it("refuses an unbalanced or one-line draft from Accounting itself", () => {
    const bad = { ...draft, payload: { ...draft.payload, lines: [{ accountKey: "bank_cash", accountName: "Bank", debitCents: 100, creditCents: 0 }] } } as ProposedAction;
    expect(() => assertActionInScope("accounting", bad)).toThrow(/balanced/);
  });

  it("refuses Accounting a non-money action", () => {
    const lead = { type: "convert_lead", priority: "high", title: "t", rationale: "r", payload: { kind: "note_only" } } as ProposedAction;
    expect(() => assertActionInScope("accounting", lead)).toThrow(/only handles money/);
  });

  it("refuses an accounting kind that carries another kind's payload (no email, no session change)", () => {
    const email = { type: "acct_anomaly", priority: "low", title: "t", rationale: "r", payload: { kind: "email", subject: "s", body: "b", notifyKind: "x" } } as ProposedAction;
    const status = { type: "acct_anomaly", priority: "low", title: "t", rationale: "r", payload: { kind: "session_status", sessionId: "s" as Id<"sessions">, newStatus: "cancelled" } } as ProposedAction;
    expect(() => assertActionInScope("accounting", email)).toThrow(/cannot carry/);
    expect(() => assertActionInScope("accounting", status)).toThrow(/cannot carry/);
  });
});

describe("(b) no other agent's generators emit ledger actions", () => {
  const id = <T extends string>(s: string) => s as Id<T & never>;
  void id;

  function everyOtherGeneratorOutput(): ProposedAction[] {
    const sessionId = "s1" as Id<"sessions">;
    const signals: Signals = {
      now: NOW, orgName: "Studio",
      quietArtists: [{ id: "a1" as Id<"artists">, name: "Q", email: "q@x.com" }],
      overdueInvoices: [{ id: "i1" as Id<"invoices">, number: "INV-1", amountCents: 100_00, artistName: "B", email: "b@x.com" }],
      unconfirmedSessions: [{ id: sessionId, title: "S", startTime: NOW + DAY, artistName: "A" }],
      depositUnpaid: [{ id: sessionId, title: "S", artistName: "A" }],
      revisionOverflow: [{ id: "g1" as Id<"songs">, title: "Song" }],
      splitSheetChase: [{ id: "g1" as Id<"songs">, title: "Song" }],
      underusedRooms: [{ id: "r1" as Id<"rooms">, name: "A" }],
      newLeads: [{ id: "a2" as Id<"artists">, name: "L", email: "l@x.com", genres: ["pop"], createdAt: NOW - DAY }],
      upcomingPrep: [{ id: sessionId, title: "S", startTime: NOW + DAY, artistName: "A", serviceType: "recording" }],
      recentlyCompleted: [{ id: sessionId, title: "S", endTime: NOW - DAY, artistName: "A", artistEmail: "a@x.com" }],
      revisionTriage: [{ id: "g1" as Id<"songs">, title: "Song", deliverableId: "d1" as Id<"deliverables">, deliverableLabel: "Mix", openComments: [] }],
      rightsMetadataGaps: [{ id: "g1" as Id<"songs">, title: "Song", missing: ["ISRC"] }],
      pricingRooms: [{ id: "r1" as Id<"rooms">, name: "A", hourlyRateCents: 5000, utilizationPct: 95 }],
      noShowRisks: [{ id: sessionId, title: "S", startTime: NOW + DAY, artistName: "A", reliability: "flagged", depositPaid: false }],
      weakLeadSources: [{ source: "ads", leadCount: 10, bookedCount: 0 }],
    };
    return [
      ...candidatesFor(signals),
      ...leadCandidates(signals.newLeads, NOW),
      ...prepCandidates(signals.upcomingPrep),
      ...recapCandidates(signals.recentlyCompleted),
      ...revisionTriageCandidates(signals.revisionTriage),
      ...pricingCandidates(signals.pricingRooms),
      ...noShowCandidates(signals.noShowRisks),
      ...weakLeadSourceCandidates(signals.weakLeadSources),
      ...riskFlagCandidates([{ category: "financial", key: "k", severity: "warning", title: "Risk", detail: "Detail" } as never]),
      ...profitLeverCandidates({ levers: [{ key: "utilization", label: "Utilization", band: "warning", detail: "d", recommendation: "r" }] } as never),
    ];
  }

  it("emits only non-accounting kinds, with no ledger payload", () => {
    const out = everyOtherGeneratorOutput();
    expect(out.length).toBeGreaterThan(15);
    for (const a of out) {
      expect(isAccountingType(a.type), a.type).toBe(false);
      expect(agentOfActionType(a.type)).not.toBe("accounting");
      expect((LEDGER_PAYLOAD_KINDS as readonly string[]).includes(a.payload.kind), `${a.type} payload ${a.payload.kind}`).toBe(false);
      // The shared guard, run as upsertProposed runs it for every other agent.
      expect(() => assertActionInScope("operations", a)).not.toThrow();
    }
  });

  it("the shared upsert path refuses an accounting proposal outright", () => {
    const sneaky = { type: "acct_receipt_link", priority: "low", title: "t", rationale: "r", payload: { kind: "acct_note", evidence: [] } } as ProposedAction;
    expect(() => assertActionInScope("operations", sneaky)).toThrow(/belong to the Accounting agent/);
  });
});

describe("(b) only the Accounting modules reach the ledger", () => {
  const raw = import.meta.glob(["../*.ts", "../lib/*.ts", "../agents/*.ts", "../marketing/*.ts", "../outreach/*.ts", "../mail/*.ts", "../../src/**/*.{ts,tsx}"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  // Vite reports files next to this test as "./x.ts"; put them under "../lib/".
  const sources: Record<string, string> = {};
  for (const [path, text] of Object.entries(raw)) sources[path.startsWith("./") ? `../lib/${path.slice(2)}` : path] = text;

  const LEDGER_USE = /journalEntries|ledgerAccounts|openingBalances|bankStatementBalances|reportedStatements|api\.ledger\b|internal\.ledger\b|from "\.\/ledger"|from "@convex\/ledger"/;
  // The books themselves, their tables and engine, and the Accounting agent.
  const MAY_TOUCH_LEDGER = new Set([
    "../ledger.ts", "../ledgerTables.ts", "../schema.ts", "../subaccountDeletion.ts", "../orgReset.ts",
    "../accountingAgent.ts", "../agents/accounting.ts", "../lib/statements.ts",
    // Types only: the ids a ledger payload names.
    "../opsBrain.ts",
  ]);

  it("no other module reads or writes the ledger tables or calls the ledger API", () => {
    const hits = Object.entries(sources)
      .filter(([path]) => !path.includes(".test.") && !path.includes(".fixture."))
      .filter(([path, text]) => LEDGER_USE.test(text) && !MAY_TOUCH_LEDGER.has(path))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it("only the shared inbox and the agent plumbing call into accountingAgent", () => {
    const allowed = new Set(["../opsActions.ts", "../agent.ts", "../agentFleet.ts", "../crons.ts", "../aiActions.ts", "../accountingAgent.ts"]);
    const hits = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([path, text]) => /(?:from "\.\.?\/accountingAgent"|(?:internal|api)\.accountingAgent)/.test(text) && !allowed.has(path) && !path.startsWith("../../src/"))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });

  it("the Accounting module posts in exactly one place: the approval path", () => {
    const text = sources["../accountingAgent.ts"];
    expect(text).toBeTruthy();
    expect(text.match(/\bpostDraft\(/g)?.length).toBe(1);
    expect(text).toMatch(/export async function approveAccountingAction[\s\S]*?postDraft\(ctx/);
    // The scan and the generators never call anything that posts, voids, edits or sends.
    for (const banned of [/voidEntry|status: "void"|voidedAt/, /ctx\.db\.delete/, /sendEmail|sendSms|notifyTeam/, /status: "posted"/]) {
      expect(text, String(banned)).not.toMatch(banned);
    }
    const pure = sources["../agents/accounting.ts"];
    expect(pure).not.toMatch(/ctx\.|\.db\b|fetch\(|process\.env/);
  });
});

describe("(c) a money question reaches the Accounting agent", () => {
  const money = [
    "Why is my cash different from the bank?",
    "Which receipts are missing for July?",
    "What did we spend on software this month?",
    "Is the month closed? What is left to do?",
    "Show me the profit and loss",
    "Can you reconcile the checking account?",
    "Why was there a $41 owner draw?",
    "How much did we pay in credit card interest?",
    "What are deposits in transit?",
    "Are my books balanced?",
    "What is our net loss for July?",
    "Where did the money go this month",
  ];
  const notMoney = [
    "Who should I follow up with from last week's leads?",
    "Is Studio A free on Thursday afternoon?",
    "Draft a recap email for yesterday's session",
    "Should I raise my room rates?",
    "Which invoices are overdue?",
    "What is the status of the Skyline mix?",
    "Plan next week's schedule",
    "How is our ad spend performing?",
  ];

  it("routes money questions to accounting", () => {
    for (const q of money) expect(routeIntent(q)?.agent, q).toBe("accounting");
  });

  it("leaves every other question to the agent that already handles it", () => {
    for (const q of notMoney) expect(routeIntent(q), q).toBeNull();
    expect(routeIntent("")).toBeNull();
  });
});

describe("copy", () => {
  it("plain() removes em and en dashes", () => {
    expect(plain("a — b – c")).toBe("a - b - c");
    expect(plain("no dashes")).toBe("no dashes");
  });
});
