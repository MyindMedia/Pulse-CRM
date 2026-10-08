/* Screen chrome that must not print, and the print layout. Scoped to
   .books-root so nothing outside the report is affected. Letter, 0.6in
   margins. The header and footer live in a table thead and tfoot, which
   browsers repeat on every printed page. */
/** Print ink and paper. The cover's text is printed in PRINT_INK on PRINT_PAPER. */
export const PRINT_INK = "#111111";
export const PRINT_PAPER = "#ffffff";

export const BOOKS_PRINT_CSS = `
.books-root .books-frame { display: block; width: 100%; min-width: 0; }
.books-root .books-frame > tbody,
.books-root .books-frame > tbody > tr,
.books-root .books-frame > tbody > tr > td { display: block; width: 100%; min-width: 0; padding: 0; }
.books-root .books-frame-head,
.books-root .books-frame-foot { display: none; }
.books-root .books-fullbook { display: none; }

@media print {
  @page {
    size: letter;
    margin: 0.6in 0.6in 0.7in;
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: #555; }
  }
  html, body { background: #fff !important; }
  /* globals.css hides every direct child of body for the run sheet. The app
     root wraps the report, so keep that one wrapper rendering. */
  body > *:has(.books-root) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; }
  body * { visibility: hidden !important; }
  .books-root, .books-root * { visibility: visible !important; }
  .books-root {
    position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important;
    background: #fff !important; color: #111 !important;
  }
  .books-root *:not(.books-print-keep) {
    background: transparent !important; color: ${PRINT_INK} !important;
    border-color: #cfcfcf !important; box-shadow: none !important; text-shadow: none !important;
    animation: none !important; transition: none !important;
  }
  .books-root .books-no-print, .books-root .books-no-print * { display: none !important; }
  /* Full book: the tabs go, the book shows. */
  .books-root[data-print-mode="full"] .books-tabwrap { display: none !important; }
  .books-root[data-print-mode="full"] .books-fullbook { display: block !important; }
  .books-root[data-print-mode="full"] table.books-frame { display: table !important; width: 100% !important; }
  .books-root .books-cover-page { display: block !important; break-after: page; page-break-after: always; }
  .books-root .books-fullbook-table { break-before: page; page-break-before: always; }
  .books-root .books-section { break-before: page; page-break-before: always; }
  .books-root .books-section > h2 { break-after: avoid; page-break-after: avoid; }
  .books-root .books-toc { list-style: none; padding: 0; }
  .books-root .books-frame { display: table !important; width: 100% !important; }
  .books-root .books-frame > thead { display: table-header-group !important; }
  .books-root .books-frame > tfoot { display: table-footer-group !important; }
  .books-root .books-frame > tbody { display: table-row-group !important; }
  .books-root .books-frame > tbody > tr { display: table-row !important; }
  .books-root .books-frame > tbody > tr > td { display: table-cell !important; padding: 0 !important; }
  .books-root .books-frame-head, .books-root .books-frame-foot { display: table-cell !important; padding: 0 0 8px !important; }
  .books-root .books-frame-foot { padding: 8px 0 0 !important; border-top: 1px solid #cfcfcf !important; font-size: 8pt; color: #555 !important; }
  .books-root .books-print-brand img { max-height: 0.5in !important; width: auto !important; }
  .books-root .books-stack { display: block !important; }
  .books-root .books-stack > * { width: 100% !important; margin-bottom: 14px !important; }
  .books-root tr, .books-root .books-avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .books-root .books-scroll { overflow: visible !important; }
  .books-root .books-sticky { position: static !important; }
  .books-root .books-expand-row { display: table-row !important; }
  .books-root .books-expand-row td { font-size: 8.5pt; }
  .books-root .books-diff-flag { font-weight: 700 !important; text-decoration: underline; }
  .books-root .books-accent-rule { background: var(--books-accent) !important; height: 3px !important; }
  .books-root .books-bar { background: #e5e5e5 !important; }
  .books-root .books-bar-fill { background: var(--books-accent) !important; }
}
`;
