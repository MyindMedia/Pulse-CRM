import { PERSONAS, THREAD_REPLY_TO, renderEmail, contentHash, type PersonaKey, type TemplateKey, type Rendered } from "./templates";
import { inlineImagesFor, type SignatureMode } from "./signatures";

/* Shared by drafts, sending and the sequence cron: how a stored draft is
   rendered, and what its approval binds to. Pure apart from hashing. */

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
export const GENERIC_HOLD = "Generic inbox: confirm who handles studio operations before pitching.";

/** Everything on a draft that decides what is sent. */
export type DraftContent = {
  recipient: string;
  persona: PersonaKey;
  templateKey: string;
  studio: string;
  signatureMode: SignatureMode;
  observation?: string;
  subjectOverride?: string;
  bodyOverride?: string;
  threadSubject?: string;
  inReplyTo?: string;
  references?: string;
};

export type RenderSettings = { bookingUrl?: string; postalAddress?: string } | null | undefined;

export function renderDraft(d: DraftContent, settings: RenderSettings): Rendered {
  return renderEmail({
    template: d.templateKey as TemplateKey, studio: d.studio, observation: d.observation,
    subjectOverride: d.subjectOverride, bodyOverride: d.bodyOverride, threadSubject: d.threadSubject,
    bookingUrl: settings?.bookingUrl, postalAddress: settings?.postalAddress, signatureMode: d.signatureMode,
  });
}

/** What defines the message: anything here changing invalidates an approval. The
 *  opening line, subject and body overrides and the threading headers are listed
 *  on their own as well as inside the rendered copy, so editing any of them voids it. */
export function hashParts(d: DraftContent & { subject: string; html: string; text: string }): string[] {
  const p = PERSONAS[d.persona];
  return [
    d.recipient, d.subject, d.html, d.text, `${p.fromName} <${p.fromEmail}>`, THREAD_REPLY_TO.join(","),
    d.templateKey, d.observation ?? "", d.subjectOverride ?? "", d.bodyOverride ?? "",
    d.threadSubject ?? "", d.inReplyTo ?? "", d.references ?? "",
    ...inlineImagesFor(d.html).map((i) => i.base64),
  ];
}

export async function renderAndHash(d: DraftContent, settings: RenderSettings): Promise<{ r: Rendered; hash: string }> {
  const r = renderDraft(d, settings);
  return { r, hash: await contentHash(hashParts({ ...d, subject: r.subject, html: r.html, text: r.text })) };
}

/** The Message-ID header set on a send. Deterministic, so a follow-up can thread to it. */
export const messageIdFor = (draftId: string) => `<pulse-outreach-${draftId}@studiopulse.tech>`;

/** Prospect statuses a draft of this template may still go to. A MaxB reply may
 *  answer a studio that replied; everything else needs a queued prospect. */
export const sendableStatuses = (templateKey: string): string[] => (templateKey === "maxb_reply" ? ["queued", "replied"] : ["queued"]);

/** The name a prospect is greeted by ("Hi <studio> team,"): its name, else its
 *  Instagram handle, else "" (the email then opens "Hi there,"). Never the website. */
export const studioName = (p: { name?: string; handle?: string }) => p.name?.trim() || p.handle?.trim() || "";

/** Plain text from a form field: trimmed, Windows line ends folded, empty -> undefined. */
export function cleanText(s: string | undefined): string | undefined {
  const v = s?.replace(/\r\n/g, "\n").trim();
  return v ? v : undefined;
}
