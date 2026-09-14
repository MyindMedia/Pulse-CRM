import { v, ConvexError } from "convex/values";
import { action, internalAction, internalQuery, query } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";
import { currentActor, currentOrgWithCapability, DEMO_ORG } from "./lib/tenant";
import { seal, open } from "./lib/secretBox";
import { plaid, PlaidError, plaidEnv, plaidConfigured, toCents, toTransactionRow, type TransactionRow } from "./lib/plaid";
import { financeLog, linkExpenseTransaction, unlink } from "./lib/financeLinks";

/* ============================================================
   Banking - the studio's bank feed, through Plaid.
   openspec/changes/add-bank-sync-receipts (finance/bank-sync).

   Who: connecting, re-authenticating, refreshing and disconnecting
   need banking.manage (owner). Reading needs insights.read (the
   books). Categorizing and adding to the books need invoices.send.

   The access token is sealed (lib/secretBox) the moment Plaid hands
   it over and is opened only inside syncConnection / disconnect,
   immediately before a Plaid call. No public function returns the
   token, its IV, the sync cursor or the Plaid item id.
   ============================================================ */

const expenseCategoryV = v.union(
  v.literal("rent"), v.literal("utilities"), v.literal("software"), v.literal("gear"),
  v.literal("repairs"), v.literal("payroll"), v.literal("contractor"), v.literal("marketing"),
  v.literal("supplies"), v.literal("insurance"), v.literal("travel"), v.literal("fees"),
  v.literal("adjustment"), v.literal("other"),
);
const excludeReasonV = v.union(
  v.literal("transfer"), v.literal("card_payment"), v.literal("loan"), v.literal("personal"), v.literal("other"),
);

const CHUNK = 200;

function friendly(err: unknown): string {
  if (err instanceof PlaidError) return err.message || `Plaid error ${err.code}`;
  if (err instanceof Error) return err.message;
  return "Something went wrong talking to the bank.";
}

// ───────────────────────────────────────────────────────── viewer checks

/** Resolve the caller for an action. Throws unless they hold `capability`. */
export const _viewer = internalQuery({
  args: { capability: v.string() },
  handler: async (ctx, { capability }) => {
    const viewer = await requireCapability(ctx, capability);
    const identity = await ctx.auth.getUserIdentity();
    return {
      orgId: viewer.orgId ?? DEMO_ORG,
      actorName: identity?.name ?? identity?.email ?? "Studio",
      subject: identity?.subject ?? "demo",
    };
  },
});

// ───────────────────────────────────────────────────────── connect

/** A Plaid Link token for connecting a new bank. Owner only. */
export const createLinkToken = action({
  args: {},
  handler: async (ctx): Promise<{ linkToken: string; environment: string }> => {
    const me = await ctx.runQuery(internal.banking._viewer, { capability: "banking.manage" });
    if (!plaidConfigured()) throw new ConvexError("Bank connections are not set up on this deployment yet.");
    try {
      const res = await plaid.linkTokenCreate({
        clientUserId: `${me.orgId}:${me.subject}`,
        webhook: process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/plaid/webhook` : undefined,
      });
      return { linkToken: res.link_token, environment: plaidEnv() };
    } catch (err) {
      throw new ConvexError(friendly(err));
    }
  },
});

/** A Link token in update mode, to repair a connection that needs sign-in. */
export const createUpdateLinkToken = action({
  args: { connectionId: v.id("bankConnections") },
  handler: async (ctx, { connectionId }): Promise<{ linkToken: string; environment: string }> => {
    const me = await ctx.runQuery(internal.banking._viewer, { capability: "banking.manage" });
    const conn = await ctx.runQuery(internal.banking._sealedConnection, { connectionId });
    if (!conn || conn.orgId !== me.orgId || !conn.tokenCiphertext || !conn.tokenIv) {
      throw new ConvexError("That bank connection can't be repaired. Connect it again.");
    }
    const accessToken = await open({ ciphertext: conn.tokenCiphertext, iv: conn.tokenIv });
    try {
      const res = await plaid.linkTokenCreate({
        clientUserId: `${me.orgId}:${me.subject}`,
        accessToken,
        webhook: process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/plaid/webhook` : undefined,
      });
      return { linkToken: res.link_token, environment: plaidEnv() };
    } catch (err) {
      throw new ConvexError(friendly(err));
    }
  },
});

/** Finish Plaid Link: exchange the public token server-side and start the import. */
export const exchangePublicToken = action({
  args: { publicToken: v.string() },
  handler: async (ctx, { publicToken }): Promise<{ connectionId: Id<"bankConnections">; institutionName: string }> => {
    const me = await ctx.runQuery(internal.banking._viewer, { capability: "banking.manage" });
    let exchanged: { access_token: string; item_id: string };
    try {
      exchanged = await plaid.publicTokenExchange(publicToken);
    } catch (err) {
      throw new ConvexError(friendly(err));
    }
    const sealed = await seal(exchanged.access_token);
    let institutionId: string | undefined;
    let institutionName = "Bank";
    let consentExpiresAt: number | undefined;
    try {
      const item = await plaid.itemGet(exchanged.access_token);
      institutionId = item.item.institution_id ?? undefined;
      if (item.item.consent_expiration_time) consentExpiresAt = Date.parse(item.item.consent_expiration_time);
      if (institutionId) institutionName = (await plaid.institutionName(institutionId)) ?? institutionName;
    } catch {
      // Institution details are cosmetic; the connection still works without them.
    }
    const connectionId = await ctx.runMutation(internal.banking._createConnection, {
      orgId: me.orgId,
      plaidItemId: exchanged.item_id,
      institutionId,
      institutionName,
      tokenCiphertext: sealed.ciphertext,
      tokenIv: sealed.iv,
      consentExpiresAt,
      connectedBy: me.actorName,
    });
    await ctx.scheduler.runAfter(0, internal.banking.syncConnection, { connectionId });
    return { connectionId, institutionName };
  },
});

export const _createConnection = internalMutation({
  args: {
    orgId: v.string(),
    plaidItemId: v.string(),
    institutionId: v.optional(v.string()),
    institutionName: v.string(),
    tokenCiphertext: v.string(),
    tokenIv: v.string(),
    consentExpiresAt: v.optional(v.number()),
    connectedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Re-linking the same login replaces the old row's token instead of
    // creating a second feed of the same transactions.
    const existing = await ctx.db
      .query("bankConnections")
      .withIndex("by_item", (q) => q.eq("plaidItemId", args.plaidItemId))
      .first();
    if (existing && existing.orgId === args.orgId) {
      await ctx.db.patch(existing._id, {
        tokenCiphertext: args.tokenCiphertext,
        tokenIv: args.tokenIv,
        status: "active",
        lastSyncError: undefined,
        institutionName: args.institutionName,
        consentExpiresAt: args.consentExpiresAt,
      });
      await financeLog(ctx, args.orgId, {
        action: "bank.reconnected", actorType: "user", actorName: args.connectedBy,
        connectionId: existing._id, detail: args.institutionName,
      });
      return existing._id;
    }
    const id = await ctx.db.insert("bankConnections", {
      orgId: args.orgId,
      plaidItemId: args.plaidItemId,
      institutionId: args.institutionId,
      institutionName: args.institutionName,
      status: "active",
      tokenCiphertext: args.tokenCiphertext,
      tokenIv: args.tokenIv,
      consentExpiresAt: args.consentExpiresAt,
      connectedBy: args.connectedBy,
      createdAt: Date.now(),
    });
    await financeLog(ctx, args.orgId, {
      action: "bank.connected", actorType: "user", actorName: args.connectedBy,
      connectionId: id, detail: args.institutionName,
    });
    return id;
  },
});

/** Internal: the sealed token and cursor for a sync. Never exposed publicly. */
export const _sealedConnection = internalQuery({
  args: { connectionId: v.id("bankConnections") },
  handler: async (ctx, { connectionId }) => {
    const c = await ctx.db.get(connectionId);
    if (!c) return null;
    return {
      orgId: c.orgId, status: c.status, cursor: c.cursor,
      tokenCiphertext: c.tokenCiphertext, tokenIv: c.tokenIv, institutionName: c.institutionName,
    };
  },
});

// ───────────────────────────────────────────────────────── sync

export const syncConnection = internalAction({
  args: { connectionId: v.id("bankConnections") },
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.runQuery(internal.banking._sealedConnection, { connectionId });
    if (!conn || !conn.tokenCiphertext || !conn.tokenIv) return;
    if (conn.status === "revoked" || conn.status === "login_required") return;

    await ctx.runMutation(internal.banking._setStatus, { connectionId, status: "syncing" });
    let accessToken: string;
    try {
      accessToken = await open({ ciphertext: conn.tokenCiphertext, iv: conn.tokenIv });
    } catch {
      await ctx.runMutation(internal.banking._syncFailed, {
        connectionId, status: "error", message: "The stored bank credentials can't be read. Reconnect this bank.",
      });
      return;
    }

    let cursor = conn.cursor;
    let added: TransactionRow[] = [];
    let modified: TransactionRow[] = [];
    let removed: string[] = [];
    let restarts = 0;
    for (;;) {
      try {
        const page = await plaid.transactionsSync(accessToken, cursor);
        added = added.concat(page.added.map(toTransactionRow));
        modified = modified.concat(page.modified.map(toTransactionRow));
        removed = removed.concat(page.removed.map((r) => r.transaction_id));
        cursor = page.next_cursor;
        if (!page.has_more) break;
      } catch (err) {
        if (err instanceof PlaidError && err.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && restarts < 3) {
          restarts++;
          cursor = conn.cursor;
          added = []; modified = []; removed = [];
          continue;
        }
        const loginNeeded = err instanceof PlaidError &&
          (err.code === "ITEM_LOGIN_REQUIRED" || err.code === "PENDING_EXPIRATION" || err.code === "ACCESS_NOT_GRANTED");
        await ctx.runMutation(internal.banking._syncFailed, {
          connectionId,
          status: loginNeeded ? "login_required" : "error",
          message: loginNeeded ? "The bank needs you to sign in again." : friendly(err),
        });
        return;
      }
    }

    try {
      const accounts = await plaid.accountsGet(accessToken);
      await ctx.runMutation(internal.banking._upsertAccounts, {
        connectionId,
        accounts: accounts.accounts.map((a) => ({
          plaidAccountId: a.account_id,
          name: a.name,
          officialName: a.official_name ?? undefined,
          mask: a.mask ?? undefined,
          type: a.type,
          subtype: a.subtype ?? undefined,
          currentCents: toCents(a.balances.current),
          availableCents: toCents(a.balances.available),
          limitCents: toCents(a.balances.limit),
          currency: a.balances.iso_currency_code ?? "USD",
        })),
      });
    } catch (err) {
      await ctx.runMutation(internal.banking._syncFailed, { connectionId, status: "error", message: friendly(err) });
      return;
    }

    // Posted rows first so a pending row they replace is relinked before it goes.
    const rows = [...added, ...modified].sort((a, b) => Number(a.pending) - Number(b.pending));
    let earliest: number | undefined;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await ctx.runMutation(internal.banking._applyTransactions, { connectionId, rows: rows.slice(i, i + CHUNK) });
      if (res.earliest !== undefined) earliest = earliest === undefined ? res.earliest : Math.min(earliest, res.earliest);
    }
    for (let i = 0; i < removed.length; i += CHUNK) {
      await ctx.runMutation(internal.banking._removeTransactions, { connectionId, plaidTransactionIds: removed.slice(i, i + CHUNK) });
    }
    await ctx.runMutation(internal.banking._finishSync, {
      connectionId, cursor, added: added.length, modified: modified.length, removed: removed.length, earliest,
    });
  },
});

export const _setStatus = internalMutation({
  args: {
    connectionId: v.id("bankConnections"),
    status: v.union(v.literal("active"), v.literal("syncing"), v.literal("login_required"), v.literal("expiring"), v.literal("revoked"), v.literal("error")),
  },
  handler: async (ctx, { connectionId, status }) => {
    const c = await ctx.db.get(connectionId);
    if (c && c.status !== "revoked") await ctx.db.patch(connectionId, { status });
  },
});

export const _syncFailed = internalMutation({
  args: {
    connectionId: v.id("bankConnections"),
    status: v.union(v.literal("login_required"), v.literal("error")),
    message: v.string(),
  },
  handler: async (ctx, { connectionId, status, message }) => {
    const c = await ctx.db.get(connectionId);
    if (!c) return;
    await ctx.db.patch(connectionId, { status, lastSyncError: message });
    await financeLog(ctx, c.orgId, {
      action: status === "login_required" ? "bank.login_required" : "bank.sync_failed",
      actorType: "system", connectionId, detail: message,
    });
  },
});

export const _upsertAccounts = internalMutation({
  args: {
    connectionId: v.id("bankConnections"),
    accounts: v.array(v.object({
      plaidAccountId: v.string(),
      name: v.string(),
      officialName: v.optional(v.string()),
      mask: v.optional(v.string()),
      type: v.string(),
      subtype: v.optional(v.string()),
      currentCents: v.optional(v.number()),
      availableCents: v.optional(v.number()),
      limitCents: v.optional(v.number()),
      currency: v.string(),
    })),
  },
  handler: async (ctx, { connectionId, accounts }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    const now = Date.now();
    for (const a of accounts) {
      const existing = await ctx.db
        .query("bankAccounts")
        .withIndex("by_plaid_account", (q) => q.eq("plaidAccountId", a.plaidAccountId))
        .first();
      if (existing && existing.connectionId === connectionId) {
        await ctx.db.patch(existing._id, { ...a, balanceAsOf: now });
      } else {
        await ctx.db.insert("bankAccounts", { orgId: conn.orgId, connectionId, ...a, balanceAsOf: now });
      }
    }
  },
});

const rowV = v.object({
  plaidTransactionId: v.string(),
  plaidAccountId: v.string(),
  pendingTransactionId: v.optional(v.string()),
  date: v.number(),
  authorizedDate: v.optional(v.number()),
  amountCents: v.number(),
  direction: v.union(v.literal("in"), v.literal("out")),
  currency: v.string(),
  name: v.string(),
  merchantName: v.optional(v.string()),
  pfcPrimary: v.optional(v.string()),
  pfcDetailed: v.optional(v.string()),
  pending: v.boolean(),
  category: v.optional(v.string()),
  excluded: v.optional(v.boolean()),
  excludeReason: v.optional(excludeReasonV),
});

export const _applyTransactions = internalMutation({
  args: { connectionId: v.id("bankConnections"), rows: v.array(rowV) },
  handler: async (ctx, { connectionId, rows }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return { earliest: undefined };
    const accountIds = new Map<string, Id<"bankAccounts">>();
    let earliest: number | undefined;
    const now = Date.now();

    for (const row of rows) {
      let accountId = accountIds.get(row.plaidAccountId);
      if (!accountId) {
        const acct = await ctx.db
          .query("bankAccounts")
          .withIndex("by_plaid_account", (q) => q.eq("plaidAccountId", row.plaidAccountId))
          .first();
        if (!acct || acct.connectionId !== connectionId) continue;
        accountId = acct._id;
        accountIds.set(row.plaidAccountId, accountId);
      }
      earliest = earliest === undefined ? row.date : Math.min(earliest, row.date);
      const { plaidAccountId: _ignored, ...fields } = row;
      void _ignored;

      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_plaid_txn", (q) => q.eq("plaidTransactionId", row.plaidTransactionId))
        .first();

      if (existing && existing.orgId === conn.orgId) {
        // A modification from the bank. Facts change; a person's decisions stay.
        await ctx.db.patch(existing._id, {
          date: fields.date, authorizedDate: fields.authorizedDate, amountCents: fields.amountCents,
          direction: fields.direction, currency: fields.currency, name: fields.name,
          merchantName: fields.merchantName, pfcPrimary: fields.pfcPrimary, pfcDetailed: fields.pfcDetailed,
          pending: fields.pending, removed: undefined, updatedAt: now,
        });
        continue;
      }

      const id = await ctx.db.insert("bankTransactions", {
        orgId: conn.orgId, connectionId, accountId, ...fields, updatedAt: now,
      });

      // A posted charge that replaces a pending one inherits its decisions and
      // links, and the pending row goes, so the spend is never shown twice.
      if (fields.pendingTransactionId) {
        const pendingRow = await ctx.db
          .query("bankTransactions")
          .withIndex("by_plaid_txn", (q) => q.eq("plaidTransactionId", fields.pendingTransactionId!))
          .first();
        if (pendingRow && pendingRow.orgId === conn.orgId && pendingRow._id !== id) {
          await ctx.db.patch(id, {
            ...(pendingRow.category ? { category: pendingRow.category } : {}),
            ...(pendingRow.excluded !== undefined ? { excluded: pendingRow.excluded, excludeReason: pendingRow.excludeReason } : {}),
            expenseId: pendingRow.expenseId,
            receiptId: pendingRow.receiptId,
          });
          if (pendingRow.expenseId) await ctx.db.patch(pendingRow.expenseId, { bankTransactionId: id });
          if (pendingRow.receiptId) await ctx.db.patch(pendingRow.receiptId, { bankTransactionId: id });
          if (pendingRow.expenseId || pendingRow.receiptId) {
            await financeLog(ctx, conn.orgId, {
              action: "match.moved_to_posted", actorType: "system", bankTransactionId: id,
              expenseId: pendingRow.expenseId, receiptId: pendingRow.receiptId,
              detail: "pending charge posted; links moved to the posted transaction",
            });
          }
          await ctx.db.delete(pendingRow._id);
        }
      }
    }
    return { earliest };
  },
});

export const _removeTransactions = internalMutation({
  args: { connectionId: v.id("bankConnections"), plaidTransactionIds: v.array(v.string()) },
  handler: async (ctx, { connectionId, plaidTransactionIds }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    for (const pid of plaidTransactionIds) {
      const row = await ctx.db
        .query("bankTransactions")
        .withIndex("by_plaid_txn", (q) => q.eq("plaidTransactionId", pid))
        .first();
      if (!row || row.orgId !== conn.orgId) continue;
      const actor = { actorType: "system" as const };
      if (row.expenseId) {
        await unlink(ctx, conn.orgId, { kind: "expense_transaction", expenseId: row.expenseId, bankTransactionId: row._id }, actor, "bank removed the transaction");
      }
      const fresh = await ctx.db.get(row._id);
      if (fresh?.receiptId) {
        await unlink(ctx, conn.orgId, { kind: "receipt_transaction", receiptId: fresh.receiptId, bankTransactionId: row._id }, actor, "bank removed the transaction");
      }
      await ctx.db.patch(row._id, { removed: true, updatedAt: Date.now() });
    }
  },
});

export const _finishSync = internalMutation({
  args: {
    connectionId: v.id("bankConnections"),
    cursor: v.optional(v.string()),
    added: v.number(),
    modified: v.number(),
    removed: v.number(),
    earliest: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.connectionId);
    if (!c) return;
    await ctx.db.patch(args.connectionId, {
      cursor: args.cursor,
      lastSyncedAt: Date.now(),
      lastSyncError: undefined,
      ...(c.status === "revoked" ? {} : { status: "active" as const }),
    });
    await financeLog(ctx, c.orgId, {
      action: "bank.synced", actorType: "system", connectionId: args.connectionId,
      after: { added: args.added, modified: args.modified, removed: args.removed },
      detail: `${args.added} added, ${args.modified} updated, ${args.removed} removed`,
    });
    if (args.added + args.modified > 0) {
      await ctx.scheduler.runAfter(0, internal.reconcile.autoMatch, { orgId: c.orgId });
    }
  },
});

/** Cron: every active connection, staggered so Plaid is not hit at once. */
export const syncAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("bankConnections").collect();
    let delay = 0;
    for (const c of all) {
      if (c.status !== "active" && c.status !== "error" && c.status !== "expiring") continue;
      if (!c.tokenCiphertext) continue;
      await ctx.scheduler.runAfter(delay, internal.banking.syncConnection, { connectionId: c._id });
      delay += 2000;
    }
  },
});

// ───────────────────────────────────────────────────────── webhook

export const _handleWebhook = internalMutation({
  args: { itemId: v.string(), type: v.string(), code: v.string(), errorCode: v.optional(v.string()) },
  handler: async (ctx, { itemId, type, code, errorCode }) => {
    const c = await ctx.db
      .query("bankConnections")
      .withIndex("by_item", (q) => q.eq("plaidItemId", itemId))
      .first();
    if (!c || c.status === "revoked") return { handled: false };

    if (type === "TRANSACTIONS" && (code === "SYNC_UPDATES_AVAILABLE" || code === "DEFAULT_UPDATE" || code === "INITIAL_UPDATE" || code === "HISTORICAL_UPDATE")) {
      await ctx.scheduler.runAfter(0, internal.banking.syncConnection, { connectionId: c._id });
      return { handled: true };
    }
    if (type === "ITEM") {
      if (code === "ERROR" && errorCode === "ITEM_LOGIN_REQUIRED") {
        await ctx.db.patch(c._id, { status: "login_required", lastSyncError: "The bank needs you to sign in again." });
        await financeLog(ctx, c.orgId, { action: "bank.login_required", actorType: "system", connectionId: c._id, detail: "Plaid webhook" });
      } else if (code === "PENDING_EXPIRATION" || code === "PENDING_DISCONNECT") {
        await ctx.db.patch(c._id, { status: "expiring" });
        await financeLog(ctx, c.orgId, { action: "bank.expiring", actorType: "system", connectionId: c._id, detail: code });
      } else if (code === "USER_PERMISSION_REVOKED" || code === "USER_ACCOUNT_REVOKED") {
        await ctx.db.patch(c._id, { status: "revoked", tokenCiphertext: undefined, tokenIv: undefined, cursor: undefined });
        await financeLog(ctx, c.orgId, { action: "bank.revoked_at_bank", actorType: "system", connectionId: c._id, detail: code });
      } else if (code === "NEW_ACCOUNTS_AVAILABLE") {
        await ctx.db.patch(c._id, { newAccountsAvailable: true });
      } else if (code === "LOGIN_REPAIRED") {
        await ctx.db.patch(c._id, { status: "active", lastSyncError: undefined });
        await ctx.scheduler.runAfter(0, internal.banking.syncConnection, { connectionId: c._id });
      }
      return { handled: true };
    }
    return { handled: false };
  },
});

// ───────────────────────────────────────────────────────── manage

/** Pull now instead of waiting for the bank. Owner only. */
export const refresh = mutation({
  args: { connectionId: v.id("bankConnections") },
  handler: async (ctx, { connectionId }) => {
    const orgId = await currentOrgWithCapability(ctx, "banking.manage");
    const c = await ctx.db.get(connectionId);
    if (!c || c.orgId !== orgId) throw new ConvexError("Bank connection not found.");
    if (c.status === "revoked") throw new ConvexError("That bank is disconnected.");
    if (c.status === "login_required") {
      // Plaid said sign-in is needed; after Link update mode succeeds, try again.
      await ctx.db.patch(connectionId, { status: "active", lastSyncError: undefined });
    }
    await ctx.scheduler.runAfter(0, internal.banking.syncConnection, { connectionId });
  },
});

export const disconnect = action({
  args: { connectionId: v.id("bankConnections"), keepHistory: v.boolean() },
  handler: async (ctx, { connectionId, keepHistory }) => {
    const me = await ctx.runQuery(internal.banking._viewer, { capability: "banking.manage" });
    const conn = await ctx.runQuery(internal.banking._sealedConnection, { connectionId });
    if (!conn || conn.orgId !== me.orgId) throw new ConvexError("Bank connection not found.");
    let removedAtPlaid = false;
    if (conn.tokenCiphertext && conn.tokenIv) {
      try {
        const token = await open({ ciphertext: conn.tokenCiphertext, iv: conn.tokenIv });
        await plaid.itemRemove(token);
        removedAtPlaid = true;
      } catch {
        // An item Plaid already forgot still gets its token destroyed here.
      }
    }
    await ctx.runMutation(internal.banking._disconnected, {
      connectionId, keepHistory, actorName: me.actorName, removedAtPlaid,
    });
  },
});

export const _disconnected = internalMutation({
  args: {
    connectionId: v.id("bankConnections"),
    keepHistory: v.boolean(),
    actorName: v.string(),
    removedAtPlaid: v.boolean(),
  },
  handler: async (ctx, { connectionId, keepHistory, actorName, removedAtPlaid }) => {
    const c = await ctx.db.get(connectionId);
    if (!c) return;
    await ctx.db.patch(connectionId, {
      status: "revoked", tokenCiphertext: undefined, tokenIv: undefined, cursor: undefined, lastSyncError: undefined,
    });
    if (!keepHistory) {
      const txns = await ctx.db.query("bankTransactions").withIndex("by_connection", (q) => q.eq("connectionId", connectionId)).collect();
      for (const t of txns) {
        if (t.expenseId) await ctx.db.patch(t.expenseId, { bankTransactionId: undefined });
        if (t.receiptId) await ctx.db.patch(t.receiptId, { bankTransactionId: undefined });
        await ctx.db.delete(t._id);
      }
      const accounts = await ctx.db.query("bankAccounts").withIndex("by_connection", (q) => q.eq("connectionId", connectionId)).collect();
      for (const a of accounts) await ctx.db.delete(a._id);
    }
    await financeLog(ctx, c.orgId, {
      action: "bank.disconnected", actorType: "user", actorName, connectionId,
      detail: `${c.institutionName}; ${keepHistory ? "history kept" : "history deleted"}${removedAtPlaid ? "" : "; Plaid item was already gone"}`,
    });
  },
});

/** Workspace deletion: remove each Plaid item. Tokens arrive sealed. */
export const removeItems = internalAction({
  args: { sealed: v.array(v.object({ ciphertext: v.string(), iv: v.string() })) },
  handler: async (_ctx, { sealed }) => {
    for (const box of sealed) {
      try {
        await plaid.itemRemove(await open(box));
      } catch {
        // Already gone at Plaid, or the key changed; nothing more to release.
      }
    }
  },
});

// ───────────────────────────────────────────────────────── books

async function loadTxn(ctx: { db: { get: (id: Id<"bankTransactions">) => Promise<Doc<"bankTransactions"> | null> } }, id: Id<"bankTransactions">, orgId: string) {
  const t = await ctx.db.get(id);
  if (!t || t.orgId !== orgId || t.removed) throw new ConvexError("Transaction not found.");
  return t;
}

export const setCategory = mutation({
  args: { id: v.id("bankTransactions"), category: expenseCategoryV },
  handler: async (ctx, { id, category }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const t = await loadTxn(ctx, id, orgId);
    await ctx.db.patch(id, { category, updatedAt: Date.now() });
    if (t.expenseId) await ctx.db.patch(t.expenseId, { category });
    await financeLog(ctx, orgId, {
      action: "transaction.categorized", actorType: "user", actorName: await currentActor(ctx),
      bankTransactionId: id, expenseId: t.expenseId, before: { category: t.category ?? null }, after: { category },
    });
  },
});

export const setExcluded = mutation({
  args: { id: v.id("bankTransactions"), excluded: v.boolean(), reason: v.optional(excludeReasonV) },
  handler: async (ctx, { id, excluded, reason }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const t = await loadTxn(ctx, id, orgId);
    if (excluded && t.expenseId) throw new ConvexError("This line is already in the books. Remove the match first.");
    await ctx.db.patch(id, { excluded, excludeReason: excluded ? (reason ?? "other") : undefined, updatedAt: Date.now() });
    await financeLog(ctx, orgId, {
      action: excluded ? "transaction.excluded" : "transaction.included", actorType: "user", actorName: await currentActor(ctx),
      bankTransactionId: id, before: { excluded: Boolean(t.excluded), reason: t.excludeReason ?? null },
      after: { excluded, reason: excluded ? (reason ?? "other") : null },
    });
  },
});

/** Put a bank outflow in the books as an expense, once. */
export const addToBooks = mutation({
  args: {
    id: v.id("bankTransactions"),
    category: expenseCategoryV,
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, { id, category, vendor, description }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const t = await loadTxn(ctx, id, orgId);
    if (t.direction !== "out") throw new ConvexError("Only money going out can be added as an expense.");
    if (t.expenseId) throw new ConvexError("This line is already in the books.");
    if (t.excluded) throw new ConvexError("This line is excluded. Include it first.");
    const actorName = await currentActor(ctx);
    const expenseId = await ctx.db.insert("expenses", {
      orgId,
      category,
      amountCents: t.amountCents,
      // Noon UTC on the bank's day, like the expense form's local noon, so the
      // day reads the same in every US time zone.
      date: t.date + 12 * 3_600_000,
      vendor: (vendor ?? t.merchantName ?? t.name).slice(0, 120),
      description,
      source: "bank",
      createdBy: actorName,
    });
    await ctx.db.patch(id, { category, updatedAt: Date.now() });
    await financeLog(ctx, orgId, {
      action: "expense.created_from_transaction", actorType: "user", actorName,
      expenseId, bankTransactionId: id, after: { amountCents: t.amountCents, category, date: t.date },
    });
    await linkExpenseTransaction(ctx, orgId, expenseId, id, { actorType: "user", actorName, reasons: ["added to the books from the bank line"] });
    return expenseId;
  },
});

// ───────────────────────────────────────────────────────── reads

const DAY = 86_400_000;

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const viewer = await resolveViewer(ctx);
    const canManage = (viewer.capabilities as ReadonlySet<string>).has("banking.manage");
    const canEdit = (viewer.capabilities as ReadonlySet<string>).has("invoices.send");

    const connections = await ctx.db.query("bankConnections").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const accounts = await ctx.db.query("bankAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const live = new Set(connections.filter((c) => c.status !== "revoked").map((c) => c._id));

    let cashOnHandCents = 0;
    let cardOwedCents = 0;
    for (const a of accounts) {
      if (a.hidden || !live.has(a.connectionId)) continue;
      if (a.type === "depository") cashOnHandCents += a.currentCents ?? 0;
      if (a.type === "credit") cardOwedCents += a.currentCents ?? 0;
    }

    const since = Date.now() - 90 * DAY;
    const recent = await ctx.db
      .query("bankTransactions")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", since))
      .collect();
    const unmatchedOutflows = recent.filter(
      (t) => !t.removed && !t.pending && t.direction === "out" && !t.excluded && !t.expenseId,
    ).length;

    return {
      configured: plaidConfigured(),
      environment: plaidEnv(),
      canManage,
      canEdit,
      cashOnHandCents,
      cardOwedCents,
      unmatchedOutflows,
      connections: connections
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((c) => ({
          _id: c._id,
          institutionName: c.institutionName,
          status: c.status,
          lastSyncedAt: c.lastSyncedAt ?? null,
          lastSyncError: c.lastSyncError ?? null,
          newAccountsAvailable: Boolean(c.newAccountsAvailable),
          connectedBy: c.connectedBy ?? null,
          createdAt: c.createdAt,
          accounts: accounts
            .filter((a) => a.connectionId === c._id)
            .map((a) => ({
              _id: a._id, name: a.name, mask: a.mask ?? null, type: a.type, subtype: a.subtype ?? null,
              currentCents: a.currentCents ?? null, availableCents: a.availableCents ?? null,
              limitCents: a.limitCents ?? null, currency: a.currency, balanceAsOf: a.balanceAsOf, hidden: Boolean(a.hidden),
            })),
        })),
    };
  },
});

export const transactions = query({
  args: {
    start: v.number(),
    end: v.number(),
    filter: v.optional(v.union(v.literal("attention"), v.literal("matched"), v.literal("excluded"), v.literal("in"), v.literal("all"))),
    accountId: v.optional(v.id("bankAccounts")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { start, end, filter, accountId, search }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    let rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", start).lt("date", end))
      .collect();
    rows = rows.filter((t) => !t.removed);
    if (accountId) rows = rows.filter((t) => t.accountId === accountId);
    const f = filter ?? "all";
    if (f === "attention") rows = rows.filter((t) => t.direction === "out" && !t.excluded && !t.expenseId && !t.pending);
    if (f === "matched") rows = rows.filter((t) => Boolean(t.expenseId || t.receiptId));
    if (f === "excluded") rows = rows.filter((t) => Boolean(t.excluded));
    if (f === "in") rows = rows.filter((t) => t.direction === "in");
    if (search?.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((t) => `${t.name} ${t.merchantName ?? ""}`.toLowerCase().includes(needle));
    }
    rows.sort((a, b) => b.date - a.date || b._creationTime - a._creationTime);
    const truncated = rows.length > 1000;
    rows = rows.slice(0, 1000);

    const accountCache = new Map<string, Doc<"bankAccounts"> | null>();
    const out = [];
    for (const t of rows) {
      if (!accountCache.has(t.accountId)) accountCache.set(t.accountId, await ctx.db.get(t.accountId));
      const acct = accountCache.get(t.accountId);
      const expense = t.expenseId ? await ctx.db.get(t.expenseId) : null;
      const receipt = t.receiptId ? await ctx.db.get(t.receiptId) : null;
      out.push({
        _id: t._id,
        date: t.date,
        amountCents: t.amountCents,
        direction: t.direction,
        name: t.name,
        merchantName: t.merchantName ?? null,
        pending: t.pending,
        category: t.category ?? null,
        excluded: Boolean(t.excluded),
        excludeReason: t.excludeReason ?? null,
        pfcPrimary: t.pfcPrimary ?? null,
        account: acct ? { name: acct.name, mask: acct.mask ?? null } : null,
        expense: expense ? { _id: expense._id, category: expense.category, vendor: expense.vendor ?? null } : null,
        receipt: receipt ? { _id: receipt._id, fileName: receipt.fileName } : null,
      });
    }
    return { rows: out, truncated };
  },
});
