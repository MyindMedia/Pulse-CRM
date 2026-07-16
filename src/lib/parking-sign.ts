/* The printable reserved-parking name badge - same branded print family as
   the front-desk check-in sign (lib/checkin-sign.ts): a pure HTML-document
   generator the dialog writes into a fresh window, which prints itself once
   fonts and the logo have loaded.

   Landscape US Letter (reads as a posted sign at a parking spot), white
   ink-friendly page, the studio's accent as the single color voice, and the
   guest's name as the hero. */

import { escapeHtml, safeAccent, type CheckinSignBrand } from "./checkin-sign";

export function parkingSignHtml(brand: CheckinSignBrand, guestName: string): string {
  const accent = safeAccent(brand.accentColor);
  const name = escapeHtml(brand.name);
  const guest = escapeHtml(guestName.trim());
  const monogram = escapeHtml((brand.name.trim()[0] ?? "P").toUpperCase());

  const logoBlock = brand.logoUrl
    ? `<img class="logo" src="${escapeHtml(brand.logoUrl)}" alt="${name}" />`
    : `<div class="monogram">${monogram}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Reserved parking - ${guest}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  :root { --accent: ${accent}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: letter landscape; margin: 0.55in; }
  html, body { background: #ffffff; }
  body {
    font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    color: #16130c;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    display: flex;
    justify-content: center;
  }
  .sheet {
    width: 9.9in;
    min-height: 7.4in;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0.4in 0.3in 0;
  }
  .logo { max-height: 0.8in; max-width: 3in; object-fit: contain; }
  .monogram {
    width: 0.8in; height: 0.8in; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent); color: #16130c;
    font-size: 28pt; font-weight: 800;
  }
  .studio {
    margin-top: 0.18in;
    font-size: 14pt; font-weight: 800;
    letter-spacing: 0.16em; text-transform: uppercase;
  }
  .rule {
    width: 1.15in; height: 3px; border-radius: 3px;
    background: var(--accent); margin: 0.26in 0;
  }
  .overline {
    font-size: 12pt; font-weight: 700; letter-spacing: 0.38em;
    text-transform: uppercase; color: #8a8272;
  }
  .guest {
    margin-top: 0.22in;
    font-size: 58pt; font-weight: 800; letter-spacing: -0.015em;
    line-height: 1.08; text-wrap: balance; max-width: 9in;
  }
  .guest em {
    font-style: normal; color: var(--accent); filter: brightness(0.82);
  }
  .note {
    margin-top: 0.24in;
    font-family: "Instrument Serif", Georgia, serif; font-style: italic;
    font-size: 17pt; color: #6b6353;
  }
  .grow { flex: 1; }
  .foot {
    width: 100%;
    padding: 0.22in 0.05in 0.05in;
    border-top: 1px solid #e7e2d6;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; color: #8a8272;
  }
</style>
</head>
<body>
  <main class="sheet">
    <div class="grow"></div>
    ${logoBlock}
    <div class="studio">${name}</div>
    <div class="rule"></div>
    <div class="overline">Reserved parking</div>
    <div class="guest">${guest}<em>.</em></div>
    <div class="note">We saved this spot for you.</div>
    <div class="grow"></div>
    <div class="foot"><span>${name}</span><span>Powered by Pulse</span></div>
  </main>
  <script>
    window.addEventListener("load", function () {
      var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      ready.then(function () { setTimeout(function () { window.print(); }, 120); });
    });
    window.onafterprint = function () { window.close(); };
  </script>
</body>
</html>`;
}
