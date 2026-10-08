/* ============================================================
   Agent scope: who may do what, and who answers a money question.

   Pure and V8-safe (no ctx). The Accounting agent is strictly scoped to the
   studio's money. This file is that scope written down as data, so a test
   can read it and a reviewer can too:

   - ACCOUNTING_CAPABILITIES: the only things the Accounting agent may do.
   - ACCOUNTING_FORBIDDEN: things it must never do, named so a regression is
     a test failure and not a judgment call.
   - AGENT_OF_ACTION_TYPE: which agent owns each proposal kind in the
     approval inbox. A kind with no owner does not compile.
   - assertActionInScope: the guard every proposal passes before it is saved.
   - routeIntent: the rule that sends a money question to Accounting.

   openspec/changes/accounting-agent/ explains the decisions.
   ============================================================ */
import type { ActionType, ProposedAction } from "../opsBrain";

export type AgentId =
  | "booking_conversion"
  | "session_prep"
  | "post_session_recap"
  | "revision_triage"
  | "rights_splits"
  | "revenue_ops"
  | "operations"
  | "marketing"
  | "accounting";

export const ACCOUNTING_AGENT = {
  id: "accounting" as const,
  name: "Accounting",
  /** Plain, calm, never alarmist. The deterministic copy follows this and the
   *  optional AI wording is held to it by lib/aiVerify (no invented figures). */
  tone: "plain, calm, never alarmist",
  summary: "Keeps the books tidy: matches receipts, clears money in transit, flags what does not add up, and tells you where the month stands. Drafts only; you approve anything that changes the books.",
} as const;

/* ── The allowlist ─────────────────────────────────────────── */

/** Everything the Accounting agent may do. Nothing outside this list. */
export const ACCOUNTING_CAPABILITIES = [
  "ledger.read",
  "expenses.read",
  "receipts.read",
  "bank.read",
  "ledger.draft_entry",
  "receipts.propose_link",
  "categories.propose",
  "insights.write",
  "approvals.propose",
  /** Only under autonomy "auto_trusted", and only an exact receipt match. */
  "receipts.link_exact",
] as const;
export type AccountingCapability = (typeof ACCOUNTING_CAPABILITIES)[number];

/** Things the Accounting agent must never do, by any path. */
export const ACCOUNTING_FORBIDDEN = [
  "ledger.post",
  "ledger.void",
  "ledger.edit_posted",
  "ledger.delete",
  "money.move",
  "email.send",
  "sms.send",
  "bookings.write",
  "rates.write",
  "members.write",
  "settings.write",
] as const;
export type ForbiddenCapability = (typeof ACCOUNTING_FORBIDDEN)[number];

export const ACCOUNTING_ACTION_TYPES = [
  "acct_clearing_draft",
  "acct_cash_draw_reclass",
  "acct_fee_split",
  "acct_receipt_link",
  "acct_receipt_missing",
  "acct_categorize",
  "acct_unexplained_cash",
  "acct_anomaly",
] as const satisfies readonly ActionType[];
export type AccountingActionType = (typeof ACCOUNTING_ACTION_TYPES)[number];

/** Payload kinds that touch the books. Only the Accounting agent emits them. */
export const LEDGER_PAYLOAD_KINDS = ["ledger_draft", "receipt_link", "acct_note"] as const;

/** The capability each proposal kind needs. A kind missing here cannot be saved. */
export const ACTION_CAPABILITY: Readonly<Record<AccountingActionType, AccountingCapability>> = {
  acct_clearing_draft: "ledger.draft_entry",
  acct_cash_draw_reclass: "ledger.draft_entry",
  acct_fee_split: "approvals.propose",
  acct_receipt_link: "receipts.propose_link",
  acct_receipt_missing: "approvals.propose",
  acct_categorize: "categories.propose",
  acct_unexplained_cash: "approvals.propose",
  acct_anomaly: "approvals.propose",
};

/** Which payload kinds each Accounting proposal may carry. */
const PAYLOAD_FOR_ACTION: Readonly<Record<AccountingActionType, readonly string[]>> = {
  acct_clearing_draft: ["ledger_draft"],
  acct_cash_draw_reclass: ["ledger_draft"],
  acct_fee_split: ["acct_note"],
  acct_receipt_link: ["receipt_link"],
  acct_receipt_missing: ["acct_note"],
  acct_categorize: ["acct_note"],
  acct_unexplained_cash: ["acct_note"],
  acct_anomaly: ["acct_note"],
};

export function isAccountingType(type: string): type is AccountingActionType {
  return (ACCOUNTING_ACTION_TYPES as readonly string[]).includes(type);
}

export function isLedgerPayloadKind(kind: string): boolean {
  return (LEDGER_PAYLOAD_KINDS as readonly string[]).includes(kind);
}

/** Who owns each proposal kind in the approval inbox. */
export const AGENT_OF_ACTION_TYPE: Readonly<Record<ActionType, AgentId>> = {
  reengage_quiet_artist: "booking_conversion",
  payment_reminder: "revenue_ops",
  confirm_unconfirmed_session: "booking_conversion",
  promote_underused_room: "revenue_ops",
  resolve_revision_overflow: "revision_triage",
  chase_split_sheet: "rights_splits",
  deposit_unpaid_nudge: "booking_conversion",
  convert_lead: "booking_conversion",
  session_prep_packet: "session_prep",
  post_session_recap: "post_session_recap",
  revision_triage: "revision_triage",
  complete_rights_metadata: "rights_splits",
  pricing_opportunity: "revenue_ops",
  no_show_risk: "revenue_ops",
  weak_lead_source: "revenue_ops",
  waitlist_fill: "booking_conversion",
  profit_improvement: "operations",
  studio_risk: "operations",
  acct_clearing_draft: "accounting",
  acct_cash_draw_reclass: "accounting",
  acct_fee_split: "accounting",
  acct_receipt_link: "accounting",
  acct_receipt_missing: "accounting",
  acct_categorize: "accounting",
  acct_unexplained_cash: "accounting",
  acct_anomaly: "accounting",
};

export function agentOfActionType(type: ActionType): AgentId {
  return AGENT_OF_ACTION_TYPE[type];
}

/** May this agent use this capability? Only Accounting holds any ledger capability. */
export function agentMay(agent: AgentId, capability: string): boolean {
  if (agent !== "accounting") return false;
  return (ACCOUNTING_CAPABILITIES as readonly string[]).includes(capability);
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/** The guard every proposal passes before it is saved. Throws a ScopeError. */
export function assertActionInScope(agent: AgentId, action: Pick<ProposedAction, "type" | "payload">): void {
  const owner = AGENT_OF_ACTION_TYPE[action.type];
  const ledgerKind = isLedgerPayloadKind(action.payload.kind);
  if (agent !== "accounting") {
    if (owner === "accounting" || ledgerKind) {
      throw new ScopeError(`The ${agent} agent cannot propose ${action.type}: books and receipts belong to the Accounting agent.`);
    }
    return;
  }
  if (!isAccountingType(action.type)) {
    throw new ScopeError(`The Accounting agent only handles money. ${action.type} belongs to the ${owner} agent.`);
  }
  const needed = ACTION_CAPABILITY[action.type];
  if (!agentMay("accounting", needed)) throw new ScopeError(`Accounting is not allowed to ${needed}.`);
  if (!PAYLOAD_FOR_ACTION[action.type].includes(action.payload.kind)) {
    throw new ScopeError(`${action.type} cannot carry a ${action.payload.kind} payload.`);
  }
  if (action.payload.kind === "ledger_draft") {
    const p = action.payload;
    const debit = p.lines.reduce((s, l) => s + l.debitCents, 0);
    const credit = p.lines.reduce((s, l) => s + l.creditCents, 0);
    if (p.lines.length < 2 || debit !== credit || debit <= 0) {
      throw new ScopeError("An accounting draft must be a balanced entry of at least two lines.");
    }
  }
}

/* ── Routing: a money question goes to Accounting ───────────── */

const MONEY_PATTERNS: readonly RegExp[] = [
  /\b(books?|bookkeep\w*|ledger|journal entr\w*|general ledger)\b/i,
  /\b(reconcil\w+|reconciliation)\b/i,
  /\b(bank (statement|balance|difference|deposit|account|feed)|my bank|the bank)\b/i,
  /\b(receipts?)\b/i,
  /\b(expenses?|expenditure|spend|spent|spending)\b/i,
  /\b(p&l|profit and loss|income statement|balance sheet|cash flow|net (income|loss)|profit|net loss)\b/i,
  /\b(month[- ]end|close (out )?the month|month close|close checklist|month (is |been )?closed|books? (are |is )?closed)\b/i,
  /\b(owner'?s? draws?|deposits? in transit|processor fees?|processing fees?|merchant fees?)\b/i,
  /\b(accountant|accounting|categori[sz]\w+|write[- ]?offs?|tax (prep|season))\b/i,
  /\b(credit card (interest|payments?|balance)|card interest)\b/i,
  /\b(cash (is|was|differ\w*|balance|on hand|position|short)|ending cash|beginning cash|negative cash)\b/i,
  /\bwhere did (the|my|our) money\b/i,
];

/** Questions that name money words but belong to another agent. Checked first. */
const OTHER_AGENT_PATTERNS: readonly { agent: AgentId; re: RegExp }[] = [
  { agent: "revenue_ops", re: /\b(raise|lower|change|set)\b.*\b(rates?|prices?|pricing)\b|\b(room rates?|hourly rates?|lead sources?)\b/i },
  { agent: "revenue_ops", re: /\b(invoices?|overdue|past due|chase)\b.*\b(client|artist|pay|paid|unpaid|overdue)\b|\b(overdue|unpaid) invoices?\b/i },
  { agent: "marketing", re: /\b(ad spend|ads? budget|campaign|social post)\b/i },
];

export type Route = { agent: AgentId; reason: string };

/** Which agent answers this free-text question? Only Accounting is claimed by
 *  keyword; anything else returns null and the general agent answers. */
export function routeIntent(text: string): Route | null {
  const q = text.trim();
  if (!q) return null;
  for (const o of OTHER_AGENT_PATTERNS) {
    if (o.re.test(q)) return null;
  }
  for (const re of MONEY_PATTERNS) {
    const m = re.exec(q);
    if (m) return { agent: "accounting", reason: `money question (${m[0].toLowerCase()})` };
  }
  return null;
}

/** The line every other agent's prompt carries so it hands money back. */
export const MONEY_HANDOFF_LINE =
  "Questions about the books, the ledger, receipts, bank reconciliation, statements or month-end belong to the Accounting agent. Do not answer them from memory or guess figures; say the Accounting agent handles that.";

/** Strip em and en dashes from copy. House rule: none in anything we write. */
export function plain(text: string): string {
  return text.replace(/\s*[–—]\s*/g, " - ").replace(/ {2,}/g, " ");
}
