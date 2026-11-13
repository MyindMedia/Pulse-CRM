/* Client emails for session file delivery (convex/sessionDelivery.ts).

   Each template returns the INNER body only (`html`: heading, paragraphs, the
   file list, small print) plus the button. notifications.deliver wraps it in
   the studio layout (studioEmailHtml) with the studio's accent and a readable
   button ink. `text` is the plain version kept in notifications.body for the
   booking's message log; it leaves out the link (the log never shows the
   delivery token; staff copy it from the delivery card instead) and every
   dollar amount (staff without money sight read the log). The amount lives
   only in `html`, which no query returns to the app.

   Every value that came from a person (studio, booking title, client name,
   file names) is escaped here. Email-safe markup only: tables and inline
   styles, no classes. */

import { escapeEmailHtml as esc } from "./layout";
import { money } from "../money";

export type DeliveryFile = { name: string; size: number };

type Rendered = { subject: string; text: string; html: string; ctaLabel: string; ctaUrl: string };

const FONT = "Inter,Segoe UI,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const TEXT = "#1a1a1f";
const MUTED = "#6b6b74";
const LINE = "#e7e7ea";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Decimal units, three significant figures: 212 KB, 58.2 MB, 1.42 GB. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  let i = 0;
  let v = n;
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  let r = Number(v.toPrecision(3));
  // 999,999 bytes rounds to "1000 KB"; say 1 MB instead.
  if (r >= 1000 && i < UNITS.length - 1) {
    i++;
    r = Number((v / 1000).toPrecision(3));
  }
  return `${i === 0 ? Math.round(n) : r} ${UNITS[i]}`;
}

/** First name, trimmed, or "" when there is none. */
function cleanName(firstName: string): string {
  return (firstName ?? "").trim();
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 14px 0;font-family:${FONT};font-size:22px;line-height:1.25;font-weight:700;color:${TEXT};">${esc(text)}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">${esc(text)}</p>`;
}

function small(text: string): string {
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${esc(text)}</p>`;
}

/** The bordered file list: name left, size right in a monospace stack. */
function fileTable(files: DeliveryFile[]): string {
  if (files.length === 0) return "";
  const rows = files
    .map((f, i) => {
      const border = i === 0 ? "" : `border-top:1px solid ${LINE};`;
      return `<tr><td style="${border}padding:10px 14px;font-family:${FONT};font-size:14px;line-height:1.4;color:${TEXT};word-break:break-word;">${esc(f.name)}</td><td align="right" style="${border}padding:10px 14px;font-family:${MONO};font-size:12px;line-height:1.4;color:${MUTED};white-space:nowrap;">${esc(formatBytes(f.size))}</td></tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${LINE};border-radius:10px;margin:0 0 18px 0;">${rows}</table>`;
}

function fileLines(files: DeliveryFile[]): string {
  return files.map((f) => `- ${f.name} (${formatBytes(f.size)})`).join("\n");
}

/** "Download your files" once the delivery is released. */
export function filesReadyEmail(a: {
  firstName: string;
  title: string;
  sessionDate: string;
  files: DeliveryFile[];
  url: string;
  expiresOn: string;
  paidCents?: number;
}): Rendered {
  const name = cleanName(a.firstName);
  const subject = `Your files from ${a.title} are ready`;
  const head = name ? `Your files are ready, ${name}` : "Your files are ready";
  const paidNow = typeof a.paidCents === "number" && a.paidCents > 0;
  const lead = `Everything from your ${a.title} session on ${a.sessionDate} is ready to download.`;
  const body = paidNow ? `${lead} Payment received: ${money(a.paidCents!)}. Thank you.` : lead;
  // The message log copy: staff without money sight read it, so no amount.
  const logBody = paidNow ? `${lead} Payment received. Thank you.` : lead;
  const fine = `The link works until ${a.expiresOn}. If it stops working, reply to this email for a new one.`;
  const ctaLabel = "Download your files";
  const html = heading(head) + para(body) + fileTable(a.files) + small(fine);
  const text = `${head}\n\n${logBody}\n\n${fileLines(a.files)}\n\n${fine}`;
  return { subject, text, html, ctaLabel, ctaUrl: a.url };
}

/** "Pay and unlock" when the files are ready and a balance is still owed. */
export function payToUnlockEmail(a: {
  firstName: string;
  title: string;
  sessionDate: string;
  files: DeliveryFile[];
  url: string;
  balanceCents: number;
}): Rendered {
  const name = cleanName(a.firstName);
  const amount = money(a.balanceCents);
  const subject = "Your files are ready. One step left";
  const head = name ? `Your files are finished, ${name}` : "Your files are finished";
  const opening = `Your ${a.title} session from ${a.sessionDate} is finished and waiting.`;
  const closing = "Once it is paid, your download link arrives right away.";
  const body = `${opening} There is a ${amount} balance on this booking. ${closing}`;
  // The message log copy: staff without money sight read it, so no amount.
  const logBody = `${opening} There is a balance on this booking. ${closing}`;
  const fine = "Already paid? Reply to this email and the studio will sort it out.";
  const ctaLabel = `Pay ${amount} and unlock`;
  const html = heading(head) + para(body) + fileTable(a.files) + small(fine);
  const text = `${head}\n\n${logBody}\n\n${fileLines(a.files)}\n\n${fine}`;
  return { subject, text, html, ctaLabel, ctaUrl: a.url };
}
