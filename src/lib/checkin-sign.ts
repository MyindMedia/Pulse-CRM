/* The printable front-desk check-in sign. A pure HTML-document generator so
   it is unit-testable and stays independent of the app shell: the dialog
   opens a fresh window, writes this document, and the document prints itself
   once fonts and the logo have loaded.

   Print-first design: white page (framed art prints better than full-bleed
   ink coverage, and browsers strip heavy backgrounds by default), the
   studio's accent as the single color voice, US Letter with generous
   margins - scales cleanly to A4. */

export type CheckinSignBrand = {
  name: string;
  tagline?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Accent must be a safe CSS hex; anything else falls back to Pulse gold. */
function safeAccent(accent?: string | null): string {
  return accent && /^#[0-9a-fA-F]{3,8}$/.test(accent) ? accent : "#fdb913";
}

export function checkinSignHtml(
  brand: CheckinSignBrand,
  visitUrl: string,
  qrSvg: string,
): string {
  const accent = safeAccent(brand.accentColor);
  const name = escapeHtml(brand.name);
  const tagline = brand.tagline ? escapeHtml(brand.tagline) : "";
  const url = escapeHtml(visitUrl);
  const monogram = escapeHtml((brand.name.trim()[0] ?? "P").toUpperCase());

  const logoBlock = brand.logoUrl
    ? `<img class="logo" src="${escapeHtml(brand.logoUrl)}" alt="${name}" />`
    : `<div class="monogram">${monogram}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Check in - ${name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@1&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root { --accent: ${accent}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: letter; margin: 0.55in; }
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
    width: 7.4in;
    min-height: 9.9in;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0.35in 0.2in 0;
  }
  .logo { max-height: 0.95in; max-width: 3.4in; object-fit: contain; }
  .monogram {
    width: 0.95in; height: 0.95in; border-radius: 999px;
    display: flex; align-items: center; justify-content: center;
    background: var(--accent); color: #16130c;
    font-size: 34pt; font-weight: 800;
  }
  .studio {
    margin-top: 0.22in;
    font-size: 19pt; font-weight: 800;
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  .tagline {
    margin-top: 0.08in;
    font-family: "Instrument Serif", Georgia, serif; font-style: italic;
    font-size: 13pt; color: #6b6353;
  }
  .rule {
    width: 1.15in; height: 3px; border-radius: 3px;
    background: var(--accent); margin: 0.3in 0 0.28in;
  }
  .overline {
    font-size: 9.5pt; font-weight: 700; letter-spacing: 0.32em;
    text-transform: uppercase; color: #8a8272;
  }
  h1 {
    margin-top: 0.1in;
    font-size: 30pt; font-weight: 800; letter-spacing: -0.01em;
  }
  h1 em {
    font-family: "Instrument Serif", Georgia, serif;
    font-style: italic; font-weight: 400; color: var(--accent);
    filter: brightness(0.82);
  }
  .qr-frame {
    margin-top: 0.34in;
    padding: 0.24in;
    border: 2.5px solid var(--accent);
    border-radius: 18px;
    background: #ffffff;
  }
  .qr-frame svg { display: block; width: 3.05in; height: 3.05in; }
  .url {
    margin-top: 0.16in;
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 10pt; color: #6b6353; letter-spacing: 0.02em;
  }
  .steps {
    margin-top: 0.4in;
    display: flex; gap: 0.32in; width: 100%;
    justify-content: center;
  }
  .step { width: 2.05in; }
  .step .n {
    width: 0.34in; height: 0.34in; margin: 0 auto;
    border-radius: 999px; background: var(--accent);
    color: #16130c; font-weight: 800; font-size: 12pt;
    display: flex; align-items: center; justify-content: center;
  }
  .step p { margin-top: 0.09in; font-size: 10.5pt; font-weight: 500; color: #3c362a; line-height: 1.45; }
  .foot {
    margin-top: auto; width: 100%;
    padding: 0.22in 0.05in 0.05in;
    border-top: 1px solid #e7e2d6;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; color: #8a8272;
  }
</style>
</head>
<body>
  <main class="sheet">
    ${logoBlock}
    <div class="studio">${name}</div>
    ${tagline ? `<div class="tagline">${tagline}</div>` : ""}
    <div class="rule"></div>
    <div class="overline">Guest check-in</div>
    <h1>Welcome. Please <em>check in.</em></h1>
    <div class="qr-frame">${qrSvg}</div>
    <div class="url">${url}</div>
    <div class="steps">
      <div class="step"><div class="n">1</div><p>Scan the code with your phone camera</p></div>
      <div class="step"><div class="n">2</div><p>Enter your name, email and who you are here to see</p></div>
      <div class="step"><div class="n">3</div><p>You are checked in. Make yourself at home</p></div>
    </div>
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
