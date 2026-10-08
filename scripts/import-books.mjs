#!/usr/bin/env node
/**
 * Import an owner's monthly books workbook into the Pulse ledger.
 *
 *   node scripts/import-books.mjs <books.xlsx> --org <orgId> --period 2026-07 \
 *     [--bank-json bank.json] [--journal-sheet "July Journal"] \
 *     [--statements-sheet "July Financial Statements"] [--all-warnings] [--json] \
 *     --dry-run | --apply
 *
 * --dry-run (the default) reads the workbook, prints entry and line counts,
 *   every warning (grouped, with source rows), the reported vs recomputed
 *   statements with variances, and the checks. Nothing is written.
 *
 * --apply calls the internal mutation ledger:importBooksInternal on the
 *   deployment named by CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL), authenticated
 *   with CONVEX_DEPLOY_KEY from the environment. Idempotent: entries already
 *   imported (same content hash) are skipped.
 *
 * --bank-json is a bank statement summary for the period, in dollars or cents:
 *   { "accountLabel": "Checking x1234", "beginning": 1687.50, "deposits": 2445.00,
 *     "withdrawals": 2505.21, "fees": 16.00, "ending": 1611.29 }
 *   Never put a full account number in accountLabel.
 *
 * The parser and the statements engine are the same TypeScript the Convex
 * functions run (convex/lib/booksImport.ts), bundled on the fly with esbuild.
 * Never commit a real workbook or a real bank JSON.
 */
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error("usage: node scripts/import-books.mjs <books.xlsx> --org <orgId> --period YYYY-MM [--bank-json file] [--dry-run|--apply]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { file: null, org: null, period: null, bankJson: null, dryRun: false, apply: false, json: false, allWarnings: false, journalSheet: undefined, statementsSheet: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${a} needs a value`);
      return v;
    };
    if (a === "--org") out.org = next();
    else if (a === "--period") out.period = next();
    else if (a === "--bank-json") out.bankJson = next();
    else if (a === "--journal-sheet") out.journalSheet = next();
    else if (a === "--statements-sheet") out.statementsSheet = next();
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--all-warnings") out.allWarnings = true;
    else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else if (!out.file) out.file = a;
    else usage(`unexpected argument ${a}`);
  }
  if (!out.file) usage("missing workbook path");
  if (!out.org) usage("missing --org");
  if (!out.period) usage("missing --period");
  if (out.dryRun && out.apply) usage("choose --dry-run or --apply, not both");
  if (!out.apply) out.dryRun = true;
  return out;
}

async function loadEngine() {
  const esbuild = require("esbuild");
  const dir = mkdtempSync(path.join(tmpdir(), "pulse-books-"));
  const outfile = path.join(dir, "booksImport.mjs");
  try {
    await esbuild.build({
      entryPoints: [path.join(root, "convex/lib/booksImport.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      logLevel: "silent",
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    // The module is already loaded; the temp file is not needed after import.
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), 0);
  }
}

const money = (c) => {
  if (c === null || c === undefined) return "";
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
};

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? String(c ?? "").padEnd(widths[i]) : String(c ?? "").padStart(widths[i]))).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** Reported vs recomputed for one statement, by line key, in recomputed order. */
function reconTable(reported, recomputedLines) {
  const rep = new Map();
  for (const l of reported) if (!rep.has(l.key)) rep.set(l.key, l);
  const rec = new Map();
  for (const l of recomputedLines) if (!rec.has(l.key)) rec.set(l.key, l);
  const keys = [...rec.keys()];
  for (const k of rep.keys()) if (!rec.has(k)) keys.push(k);
  const rows = [];
  for (const k of keys) {
    const r = rep.get(k);
    const c = rec.get(k);
    if (!r && c && c.cents === 0) continue; // zero lines nobody reported
    const rc = r ? r.cents : null;
    const cc = c ? c.cents : null;
    // A subtotal the owner never reported is not a disagreement.
    const variance = !r && c?.kind === "total" ? 0 : (cc ?? 0) - (rc ?? 0);
    rows.push([
      `${(c?.kind ?? r?.kind) === "total" ? "= " : "  "}${c?.label ?? r?.label ?? k}`,
      rc === null ? "(none)" : money(rc),
      cc === null ? "(none)" : money(cc),
      variance === 0 ? "" : `${variance > 0 ? "+" : ""}${money(variance)}`,
    ]);
  }
  return table(rows, ["Line", "Reported", "Recomputed", "Variance"]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const XLSX = require("xlsx");
  const engine = await loadEngine();

  const wb = XLSX.read(readFileSync(args.file), { type: "buffer", cellFormula: true, cellDates: false, cellNF: true });
  const grid = engine.gridFromSheetJs(wb, XLSX);
  const plan = engine.parseBooksWorkbook(grid, {
    period: args.period,
    journalSheet: args.journalSheet,
    statementsSheet: args.statementsSheet,
  });
  const bank = args.bankJson
    ? [engine.bankBalanceFromJson(JSON.parse(readFileSync(args.bankJson, "utf8")), plan.period)]
    : [];
  const recon = engine.reconcilePlan(plan, bank);

  if (args.json) {
    console.log(JSON.stringify({ stats: plan.stats, importBatchId: plan.importBatchId, warnings: plan.warnings, openingWarnings: recon.openingWarnings, variances: recon.variances, checks: recon.checks }, null, 2));
  } else {
    console.log(`Books import ${args.dryRun ? "DRY RUN" : "APPLY"}  period ${plan.period.key}  org ${args.org}`);
    console.log(`Batch ${plan.importBatchId}`);
    console.log(`Journal: ${plan.stats.lines} lines, ${plan.stats.entries} entries, debits ${money(plan.stats.totalDebitCents)}, credits ${money(plan.stats.totalCreditCents)}`);
    console.log(`Chart: ${plan.chart.length} accounts. Reported lines: BS ${plan.reported.balanceSheet.length}, IS ${plan.reported.incomeStatement.length}, CF ${plan.reported.cashFlow.length}`);

    const byCode = new Map();
    for (const w of plan.warnings) byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);
    console.log(`\nWarnings: ${plan.warnings.length}`);
    console.log(table([...byCode.entries()].map(([code, ws]) => [code, ws[0].severity, ws.length, ws.filter((w) => w.row).map((w) => w.row).join(",")]), ["Code", "Severity", "Count", "Rows"]));
    const show = args.allWarnings ? plan.warnings : plan.warnings.filter((w) => w.severity !== "info");
    if (show.length) {
      console.log(`\n${args.allWarnings ? "All warnings" : "Warnings (warn and error; --all-warnings for info)"}:`);
      for (const w of show) console.log(`  [${w.severity}] ${w.code}${w.row ? ` row ${w.row}` : ""}${w.cell ? ` ${w.cell}` : ""}: ${w.message}`);
    }
    console.log("\nOpening balances (implied, not from the books):");
    for (const w of recon.openingWarnings) console.log(`  [${w.severity}] ${w.code}: ${w.message}`);

    console.log("\nINCOME STATEMENT");
    console.log(reconTable(plan.reported.incomeStatement, recon.recomputed.incomeStatement.lines));
    console.log("\nBALANCE SHEET");
    console.log(reconTable(plan.reported.balanceSheet, recon.recomputed.balanceSheet.lines));
    const re = recon.recomputed.balanceSheet.retainedEarnings;
    console.log(`  retained earnings (derived): opening ${money(re.openingCents)} + prior unclosed ${money(re.priorUnclosedIncomeCents)} + this period ${money(re.currentPeriodNetIncomeCents)} = ${money(re.totalCents)}`);
    console.log("\nCASH FLOW (direct)");
    console.log(reconTable(plan.reported.cashFlow, recon.recomputed.cashFlow.lines));

    console.log("\nCHECKS");
    for (const c of recon.checks) console.log(`  ${c.status.toUpperCase().padEnd(4)} ${c.code}: ${c.message}`);
    const bankCheck = recon.checks.find((c) => c.code === "cash_vs_bank" && c.detail);
    if (bankCheck) {
      const d = bankCheck.detail;
      console.log("\nBANK RECONCILIATION");
      console.log(table([
        ["Beginning", money(d.bankBeginningCents), money(d.ledgerBeginningCents), money(d.beginningVarianceCents)],
        ["Net change", money(d.bankNetChangeCents), money(d.ledgerNetChangeCents), money(d.netChangeVarianceCents)],
        ["Ending", money(d.bankEndingCents), money(d.ledgerEndingCents), money(d.endingVarianceCents)],
      ], ["", "Bank", "Ledger", "Ledger - Bank"]));
      console.log(`  statement arithmetic check: ${money(d.bankArithmeticDiffCents)} (0.00 means it adds up)`);
      console.log(`  uncleared clearing balances: ${d.unclearedClearing.map((u) => `${u.name} ${money(u.cents)}`).join(", ") || "none"}; total ${money(d.unclearedClearingTotalCents)}; unexplained ${money(d.unexplainedCents)}`);
    }
  }

  if (args.dryRun) return;

  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const key = process.env.CONVEX_DEPLOY_KEY;
  if (!url || !key) usage("--apply needs CONVEX_URL (or NEXT_PUBLIC_CONVEX_URL) and CONVEX_DEPLOY_KEY in the environment");
  const blocking = plan.warnings.filter((w) => w.severity === "error");
  if (blocking.length) {
    console.error(`\nRefusing to apply: ${blocking.length} error-level warnings. Fix the workbook and re-run.`);
    process.exit(1);
  }
  const { ConvexHttpClient } = await import("convex/browser");
  const { makeFunctionReference } = await import("convex/server");
  const client = new ConvexHttpClient(url);
  client.setAdminAuth(key);
  const result = await client.mutation(makeFunctionReference("ledger:importBooksInternal"), {
    orgId: args.org,
    plan: engine.planToImportArgs(plan),
    bank: bank.map((b) => ({ ...b })),
    seedOpening: "implied",
  });
  console.log("\nApplied:", JSON.stringify(result));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
