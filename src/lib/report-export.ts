/* ============================================================
   Report export - turn a generated report table into a printable
   PDF (via the browser's print dialog -> "Save as PDF") or a CSV
   download. Used by the Reports page Report Builder.

   No PDF dependency: we render a clean, self-contained HTML document
   in a new window and trigger print, so "Save as PDF" works in every
   browser and the studio gets a branded, printable report.
   ============================================================ */
import type { ColumnFormat } from "@convex/lib/reportEngine";
import { money } from "@/lib/format";

/** Format one aggregated value for display in the table / print / CSV. */
export function formatMetric(value: number, format: ColumnFormat): string {
  switch (format) {
    case "money":
      return money(Math.round(value));
    case "hours":
      return `${(Math.round(value * 10) / 10).toLocaleString()}h`;
    case "number":
      return Math.round(value).toLocaleString();
    default:
      return String(value);
  }
}

export type PrintColumn = { key: string; label: string; format: ColumnFormat };
export type PrintRow = { group: string; values: Record<string, number> };

export type PrintableReport = {
  orgName: string;
  title: string;
  /** e.g. "Sessions & bookings · grouped by Room" */
  source: string;
  dateRange: string;
  generatedAt: number;
  columns: PrintColumn[];
  rows: PrintRow[];
  totals: Record<string, number>;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a fully self-contained, print-ready HTML document for the report. */
export function buildPrintableHtml(r: PrintableReport): string {
  const generated = new Date(r.generatedAt).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const head = r.columns
    .map((c, i) => `<th class="${i === 0 ? "left" : "right"}">${esc(c.label)}</th>`)
    .join("");

  const body = r.rows
    .map((row) => {
      const cells = r.columns
        .map((c, i) => {
          if (i === 0) return `<td class="left">${esc(row.group)}</td>`;
          return `<td class="right">${esc(formatMetric(row.values[c.key] ?? 0, c.format))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const totalCells = r.columns
    .map((c, i) => {
      if (i === 0) return `<td class="left"><strong>Total</strong></td>`;
      return `<td class="right"><strong>${esc(formatMetric(r.totals[c.key] ?? 0, c.format))}</strong></td>`;
    })
    .join("");

  const rowsBlock =
    r.rows.length > 0
      ? body
      : `<tr><td class="left" colspan="${r.columns.length}">No data in this range.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(r.title)} — ${esc(r.orgName)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #18181b; background: #fff; padding: 40px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .report { max-width: 900px; margin: 0 auto; }
  header { border-bottom: 2px solid #18181b; padding-bottom: 16px; margin-bottom: 8px; }
  .org { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #71717a; font-weight: 600; }
  h1 { font-size: 26px; margin: 6px 0 4px; }
  .sub { font-size: 13px; color: #52525b; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e4e4e7; }
  th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #71717a; border-bottom: 1.5px solid #a1a1aa; }
  td.right, th.right { text-align: right; font-variant-numeric: tabular-nums; }
  td.left, th.left { text-align: left; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tfoot td { border-top: 2px solid #18181b; border-bottom: none; padding-top: 10px; font-variant-numeric: tabular-nums; }
  footer { margin-top: 28px; font-size: 11px; color: #a1a1aa; text-align: center; }
  @media print {
    body { padding: 0; }
    @page { margin: 18mm; }
  }
</style>
</head>
<body>
  <div class="report">
    <header>
      <div class="org">${esc(r.orgName)}</div>
      <h1>${esc(r.title)}</h1>
      <p class="sub">${esc(r.source)}</p>
      <p class="sub">${esc(r.dateRange)}</p>
    </header>
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${rowsBlock}</tbody>
      <tfoot><tr>${totalCells}</tr></tfoot>
    </table>
    <footer>Generated ${esc(generated)} · Pulse Studio OS</footer>
  </div>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.focus(); window.print(); }, 150);
    });
  </script>
</body>
</html>`;
}

/** Open the report in a new window and trigger the print / save-as-PDF dialog. */
export function printReport(r: PrintableReport): boolean {
  const html = buildPrintableHtml(r);
  const win = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
  if (!win) return false; // popup blocked
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

/* ── CSV ── */

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from the report (raw numbers, not formatted, so it
 *  re-aggregates cleanly in a spreadsheet). */
export function buildCsv(r: PrintableReport): string {
  const header = r.columns.map((c) => csvCell(c.label)).join(",");
  const lines = r.rows.map((row) =>
    r.columns
      .map((c, i) => (i === 0 ? csvCell(row.group) : String(row.values[c.key] ?? 0)))
      .join(","),
  );
  const totals = r.columns
    .map((c, i) => (i === 0 ? csvCell("Total") : String(r.totals[c.key] ?? 0)))
    .join(",");
  return [header, ...lines, totals].join("\n");
}

/** Trigger a CSV file download in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
