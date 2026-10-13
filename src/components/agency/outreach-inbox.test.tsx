import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import type { InboxRow, TimelineItem } from "@convex/outreach/inbox";

/* Server-render the Prospects inbox against fixture query results: the list,
   the reading pane, the contact card, the conversation and the Prepare email
   form. Proves states, copy and gates render; it is not a browser check. */
const fixtures: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: never, args?: unknown) => (args === "skip" ? undefined : fixtures[getFunctionName(ref)]),
  useMutation: () => async () => null,
  useConvex: () => ({ query: async () => null }),
}));

import {
  AddStudiosHelp, BulkRoutingBar, ContactDetails, ConversationPane, ConversationTimeline, ImportCsvHelp, InboxListRow,
  OutreachInbox, PrepareEmailForm, frameHeight, type InboxProspect,
} from "./outreach-inbox";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;
beforeEach(() => { for (const k of Object.keys(fixtures)) delete fixtures[k]; });

const contacts = (address: string, generic: boolean, extra: Record<string, unknown> = {}) => ({
  emails: [{ address, generic, rank: 50, sourceUrl: "https://mix.com/contact", suppressed: false, ...extra }],
  phones: [{ number: "(323) 760-7557", sourceUrl: "https://mix.com" }],
  socials: [{ platform: "instagram", url: "https://instagram.com/mixrec" }], booking: ["GoHighLevel"], scrapedAt: 0,
});
const prospect = (extra: Record<string, unknown> = {}) => ({
  id: "p1", handle: null, name: "MIX Recording Studio", websiteUrl: "https://mix.com", source: "paste", status: "queued", note: null,
  bookedAt: null, repliedAt: null, replyIntent: null, routingConfirmed: false, hook: "Saw your second live room.", hookSourceUrl: "https://mix.com/news",
  subjectDefault: null, bodyDefault: null, hasFollowupOverrides: false, fitScore: null, priority: null, sequence: null, createdAt: 0,
  contacts: contacts("jane@mix.com", false), displayName: "MIX Recording Studio", host: "mix.com", routingConfirmedAt: null, ...extra,
}) as unknown as InboxProspect;
const setConv = (p: InboxProspect, extra: Record<string, unknown> = {}) => {
  fixtures["outreachInbox:conversation"] = { canManage: true, mailVisible: true, prospect: p, timeline: [], truncated: false, unreadThreadIds: [], ...extra };
};
const pane = () => html(
  <ConversationPane prospectId={"p1" as never} prep={{}} onPrep={noop} site="" onSite={noop} onBack={noop} onGone={noop} />,
);
const form = (p: InboxProspect) => html(<PrepareEmailForm p={p} cur={{}} onChange={noop} onPrepare={noop} />);

const row = (extra: Partial<InboxRow> = {}): InboxRow => ({
  id: "p1" as InboxRow["id"], name: "MIX Recording", handle: "mixrec", host: "mix.com", websiteUrl: "https://mix.com", primaryEmail: "jane@mix.com",
  emails: ["jane@mix.com"], status: "queued", note: null, createdAt: 0, lastActivityAt: Date.now(), lastKind: "email", lastDirection: "out",
  lastSnippet: "A question about running MIX", hasUnreadReply: false, replied: false, replyIntent: null, bookedAt: null, optedOut: false,
  routingConfirmed: false, sequence: { step: 0, status: "active" }, ...extra,
});
const stopped = { step: 0, status: "stopped", nextDueAt: null, recipient: "jane@mix.com", stoppedReason: "replied", stoppedMeaning: "The studio replied.", pendingDraft: false };

describe("Prospects inbox: list", () => {
  it("shows loading, then the agency-required state", () => {
    expect(html(<OutreachInbox />)).toContain("Loading prospects");
    fixtures["outreachInbox:list"] = null;
    expect(html(<OutreachInbox />)).toContain("Agency membership required");
  });

  it("empty state, and non-managers cannot add or import", () => {
    fixtures["outreachInbox:list"] = { canManage: false, mailVisible: false, suppressedCount: 0, rows: [] };
    const out = html(<OutreachInbox />);
    expect(out).toContain("No prospects yet");
    expect(out).toContain("Only an owner or admin can add or change prospects.");
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Add studios/);
    expect(out).not.toContain("Import outreach CSV");
  });

  it("rows: newest first with a one-line preview, an unread reply in bold with its own chip, and counts on every filter", () => {
    fixtures["outreachInbox:list"] = {
      canManage: true, mailVisible: true, suppressedCount: 1, rows: [
        row({ id: "a" as InboxRow["id"], name: "Ice Cream Sound", lastKind: "mail", lastDirection: "in", lastSnippet: "Thanks, we're interested", hasUnreadReply: true, replied: true }),
        row({ id: "b" as InboxRow["id"], name: "MIX Recording" }),
        row({ id: "c" as InboxRow["id"], name: "@newstudio", status: "needs_website", lastKind: "status", lastDirection: null, lastSnippet: null, sequence: null }),
      ],
    };
    const out = html(<OutreachInbox />);
    expect(out.indexOf("Ice Cream Sound")).toBeLessThan(out.indexOf("MIX Recording"));
    expect(out).toMatch(/font-semibold text-bone">Ice Cream Sound<span class="sr-only">, unread reply<\/span>/);
    expect(out).toContain(">new reply</span>");
    expect(out).toContain('<span class="sr-only">Received: </span>');
    expect(out).toContain('<span class="sr-only">Sent: </span>');
    expect(out).toContain("Waiting for you to confirm the studio&#x27;s website.");
    expect(out).toContain(">emailed</span>");
    expect(out).toContain("3 studios · 2 need action · 1 unread reply");
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*All.*>3</);
    expect(out).toContain("Needs action");
    expect(out).toContain("Pick a studio to see its conversation");
    expect(out).toContain("Import outreach CSV");
    expect(out).toContain("Select");
    expect(out).toContain("opt-out list");
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("a selected row is marked current; select mode turns rows into checkboxes", () => {
    const r = row();
    expect(html(<InboxListRow r={r} active selecting={false} checked={false} onOpen={noop} onCheck={noop} />)).toContain('aria-current="true"');
    const sel = html(<InboxListRow r={r} active={false} selecting checked onOpen={noop} onCheck={noop} />);
    expect(sel).toMatch(/<input type="checkbox" aria-label="Select MIX Recording"[^>]*checked=""/);
    expect(sel).not.toContain("<button");
  });

  it("bulk routing confirm is a separate step and says it never approves", () => {
    const out = html(<BulkRoutingBar selecting count={0} onStart={noop} onCancel={noop} onConfirm={noop} />);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Confirm routing for selected \(0\)/);
    expect(out).toContain("it never approves an email");
  });

  it("the dialogs keep their rules: published not verified, nothing emailed, CSV never imports an address", () => {
    expect(html(<AddStudiosHelp />)).toContain("It is published, not verified. Nothing is emailed from here.");
    const csv = html(<ImportCsvHelp />);
    expect(csv).toContain("It updates studios already on the list and never adds one.");
    expect(csv).toContain("Email addresses in the file are never imported as contacts.");
    expect(csv).toContain("Up to 200 rows");
  });
});

describe("Prospects inbox: reading pane", () => {
  it("shows loading, then a clear message when the studio is gone", () => {
    expect(pane()).toContain("Loading the conversation");
    fixtures["outreachInbox:conversation"] = null;
    expect(pane()).toContain("This studio is no longer on the list.");
  });

  it("header: name, handle, website and primary email, status, and a Contact info toggle that starts closed", () => {
    setConv(prospect({ handle: "mixrec", status: "scraped" }));
    const out = pane();
    expect(out).toContain("MIX Recording Studio");
    expect(out).toContain("@mixrec");
    expect(out).toContain('href="https://mix.com"');
    expect(out).toContain("jane@mix.com");
    expect(out).toContain(">scraped</span>");
    expect(out).toMatch(/aria-expanded="false" aria-controls="contact-info-p1" aria-label="Contact info"/);
    expect(out).toContain("Queue for review");
    expect(out).toContain("Read again");
    expect(out).toContain("Remove");
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("a studio waiting for a website asks for it", () => {
    setConv(prospect({ status: "needs_website", websiteUrl: null, host: null, contacts: null }));
    const out = pane();
    expect(out).toContain("Confirm website");
    expect(out).toContain("No website yet");
  });

  it("queued: Mark replied and a Compose bar for Lawrence's first email", () => {
    setConv(prospect());
    const out = pane();
    expect(out).toContain("Mark replied");
    expect(out).toContain("Prepare Lawrence&#x27;s first email");
    expect(out).toContain('aria-expanded="false" aria-controls="compose-p1"');
  });

  it("once Lawrence has emailed: the sequence line, Stop follow-ups, and a MaxB compose bar", () => {
    setConv(prospect({ sequence: { step: 1, status: "active", nextDueAt: 1_800_000_000_000, recipient: "jane@mix.com", stoppedReason: null, stoppedMeaning: null, pendingDraft: false } }));
    const out = pane();
    expect(out).toContain("Sent: MaxB day 3.");
    expect(out).toContain("MaxB day 7 will be drafted for review");
    expect(out).toContain("Stop follow-ups");
    expect(out).toContain("Prepare a MaxB reply in the thread");
  });

  it("a stopped sequence says why; a replied studio shows the replied status and no stale actions", () => {
    setConv(prospect({ status: "replied", sequence: stopped }));
    const out = pane();
    expect(out).toContain("Follow-ups stopped. The studio replied.");
    expect(out).toContain(">replied</span>");
    expect(out).toContain("Follow-ups stopped; MaxB can still reply in the thread.");
    expect(out).not.toContain("Mark replied");
    expect(out).not.toContain("Stop follow-ups");
  });

  it("a studio's reply shows Jev's label, and says when the address was opted out automatically", () => {
    setConv(prospect({ status: "replied", sequence: stopped, replyIntent: { label: "interested", probability: 0.94, confidence: 0.93, optedOut: false, receivedAt: 0 } }));
    const yes = pane();
    expect(yes).toContain(">reply: interested</span>");
    expect(yes).toContain("94% sure");
    expect(yes).toContain("A label only: nothing was changed.");
    setConv(prospect({ status: "suppressed", replyIntent: { label: "unsubscribe", probability: 0.97, confidence: 0.96, optedOut: true, receivedAt: 0 } }));
    const stop = pane();
    expect(stop).toContain(">reply: asked to stop</span>");
    expect(stop).toContain("The address was opted out automatically.");
    setConv(prospect());
    expect(pane()).not.toContain("reply: ");
  });

  it("non-managers read, but cannot act, compose, or see reply text they cannot read in the Email tab", () => {
    setConv(prospect(), { canManage: false, mailVisible: false });
    const out = pane();
    expect(out).toContain("Only an owner or admin can change prospects.");
    expect(out).toContain("Replies are shown to owners and admins who can read the Email tab.");
    for (const action of ["Queue for review", "Mark replied", "Remove", "Prepare Lawrence", "Prepare the email"]) expect(out).not.toContain(action);
  });
});

describe("Prospects inbox: contact card", () => {
  it("published-not-verified labels, the generic-inbox warning, opt-out and routing", () => {
    const p = prospect({ handle: "mixrec", contacts: contacts("info@mix.com", true) });
    const out = html(<ContactDetails p={p} manage onOptOut={noop} onConfirmRouting={noop} />);
    expect(out).toContain("Emails (published, not verified)");
    expect(out).toContain("generic inbox");
    expect(out).toContain("A generic inbox is not a confirmed decision-maker. Confirm routing before pitching.");
    expect(out).toContain("mark opted out");
    expect(out).toContain("(323) 760-7557");
    expect(out).toContain('href="https://instagram.com/mixrec"');
    expect(out).toContain("Booking: GoHighLevel");
    expect(out).toContain(">Confirm routing</button>");
    const done = html(<ContactDetails p={prospect({ contacts: contacts("info@mix.com", true), routingConfirmed: true })} manage onOptOut={noop} onConfirmRouting={noop} />);
    expect(done).toContain("routing confirmed");
    expect(done).not.toContain(">Confirm routing</button>");
    const optedOut = html(<ContactDetails p={prospect({ contacts: contacts("jane@mix.com", false, { suppressed: true }) })} manage onOptOut={noop} onConfirmRouting={noop} />);
    expect(optedOut).toContain(">opted out</span>");
    expect(optedOut).not.toContain("mark opted out");
    expect(html(<ContactDetails p={prospect({ contacts: null })} manage={false} onOptOut={noop} onConfirmRouting={noop} />)).toContain("No contact info yet.");
  });
});

describe("Prospects inbox: Prepare email (Lawrence first, MaxB follow-ups)", () => {
  it("Lawrence is the default sender for the first email, with the opening line prefilled", () => {
    const out = form(prospect());
    expect(out).toContain("Prepare the email");
    expect(out).toMatch(/<option value="lawrence" selected="">Lawrence Berment \(first email\)<\/option>/);
    expect(out).toMatch(/<option value="maxb" disabled="">MaxB \| Pulse \(reply in the thread\)<\/option>/);
    expect(out).toContain("Opening line");
    expect(out).toContain('value="Saw your second live room."');
    expect(out).toContain("Subject (optional)");
    expect(out).toContain("Body (optional");
    expect(out).toContain("Source: https://mix.com/news");
    expect(out).toContain("The first email to a studio comes from Lawrence");
    expect(out).not.toContain("no approved copy yet");
  });

  it("prepare is off until there is an opening line", () => {
    const out = form(prospect({ hook: null }));
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Prepare email/);
    expect(out).toContain("Add an opening line to prepare Lawrence&#x27;s email.");
  });

  it("once Lawrence has emailed, MaxB replies in the thread", () => {
    const out = form(prospect({ sequence: { step: 1, status: "active", nextDueAt: 1, recipient: "jane@mix.com", stoppedReason: null, stoppedMeaning: null, pendingDraft: false } }));
    expect(out).toMatch(/<option value="lawrence" disabled="">/);
    expect(out).toMatch(/<option value="maxb" selected="">/);
    expect(out).toContain("MaxB replies in Lawrence&#x27;s thread");
    expect(out).not.toContain("Opening line");
  });

  it("a generic inbox needs the routing confirmation, unless routing was confirmed for the studio", () => {
    expect(form(prospect({ contacts: contacts("info@mix.com", true) }))).toContain("This is a generic inbox. I have confirmed who handles studio operations.");
    expect(form(prospect({ contacts: contacts("info@mix.com", true), routingConfirmed: true }))).not.toContain("This is a generic inbox. I have confirmed");
  });
});

describe("Prospects inbox: conversation", () => {
  const base = { cc: [], htmlTruncated: false, bodyOmitted: false, bodyPending: false, messageId: null, threadId: null, unread: false, intent: null, attachments: [], authFailed: false };
  const items: TimelineItem[] = [
    { id: "event:added", kind: "event", at: 1, direction: null, text: "Added to the list by paste." },
    { ...base, id: "draft:d1", kind: "email", source: "outreach", at: 2, direction: "out", from: "Lawrence Berment <lawrenceb@studiopulse.tech>", to: ["jane@mix.com"], subject: "A question about running MIX", snippet: "Hi MIX team, Saw your second live room.", text: "Hi MIX team", html: "<p>Hi</p>", label: "Step 0: First email (Lawrence)", draftId: "d1" as never, delivery: { status: "delivered", meaning: "The provider reports delivery to the recipient's mail server.", error: null } },
    { ...base, id: "mail:m1", kind: "email", source: "mail", at: 3, direction: "in", from: "Jane <jane@mix.com>", to: ["info@studiopulse.tech"], subject: "Re: A question", snippet: "Thanks, we're interested", text: "Thanks, we're interested", html: "<p>Thanks, we're interested</p><script>alert(1)</script>", label: null, draftId: null, messageId: "m1" as never, threadId: "t1" as never, unread: true, intent: { label: "interested", probability: 0.94, optedOut: false }, delivery: null },
    { id: "dm:1", kind: "dm", at: 4, direction: "out", status: "sent", handle: "mixrec", text: "Hey MIX team", snippet: "Hey MIX team" },
    { id: "pending:d2", kind: "draft", at: 5, direction: "out", draftId: "d2" as never, status: "hold", holdReason: "Generic inbox: confirm who handles studio operations before pitching.", label: "Reply in the thread (MaxB)", from: "MaxB | Pulse <info@studiopulse.tech>", to: ["jane@mix.com"], subject: "Re: A question", snippet: "Hi again", text: "Hi again" },
    { id: "call:1", kind: "call", at: 6, direction: "out", status: "completed", skipReason: null, summary: "Confirmed for Tuesday", disposition: "confirmed", error: null, answeredBy: "human" },
    { id: "booking:1", kind: "booking", at: 7, direction: null, status: "confirmed", title: "Pulse demo", startsAt: 7, endsAt: 8, timezone: "America/Los_Angeles", location: "Zoom", meetingUrl: "https://zoom.us/j/1", contactName: "Jane", contactEmail: "jane@mix.com" },
  ];

  it("the newest message and the unread reply are open, older ones fold to a line, and every state carries a word and an icon", () => {
    const out = html(<ConversationTimeline items={items} />);
    // The waiting draft is the newest message and the studio's unread reply is the
    // newest email: both open. Lawrence's first email and the DM fold to one line.
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(out).toMatch(/aria-expanded="true"[^>]*>(?:(?!<\/button>).)*Draft, not sent/);
    expect(out).toMatch(/aria-expanded="true"[^>]*>(?:(?!<\/button>).)*Received/);
    expect(out).toMatch(/aria-expanded="false"[^>]*>(?:(?!<\/button>).)*Sent/);
    expect(out).toContain(">Sent</span>");
    expect(out).toContain(">Received</span>");
    expect(out).toContain(">Instagram DM</span>");
    expect(out).toContain("on hold");
    expect(out).toContain("Generic inbox: confirm who handles studio operations before pitching.");
    expect(out).toContain("Nothing has been sent. Approve and send it in the Review queue.");
    expect(out).toContain("Confirmation call");
    expect(out).toContain("Confirmed for Tuesday");
    expect(out).toContain("Demo booked:");
    expect(out).toContain("Added to the list by paste.");
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("an open received message renders in the sandboxed frame, never as raw HTML, with Jev's label", () => {
    const out = html(<ConversationTimeline items={items.slice(0, 3)} />);
    expect(out).toMatch(/aria-expanded="true"[^>]*>(?:(?!<\/button>).)*Received/);
    expect(out).toContain('sandbox="allow-popups"');
    expect(out).not.toContain("<p>Thanks, we&#x27;re interested</p>");
    expect(out).not.toContain("<script>");
    expect(out).toContain(">reply: interested</span>");
    expect(out).toContain(">new</span>");
  });

  it("an open sent email shows what the provider said, and Lawrence's email as it went out", () => {
    fixtures["outreachDrafts:preview"] = { html: "<p>Hi MIX team</p>", text: "Hi MIX team", subject: "s", from: "x", to: "jane@mix.com", links: [], inline: [], signatureMode: "image", inReplyTo: null };
    const out = html(<ConversationTimeline items={items.slice(0, 2)} />);
    expect(out).toContain(">delivered</span>");
    expect(out).toContain("The provider reports delivery to the recipient&#x27;s mail server.");
    expect(out).toContain("Step 0: First email (Lawrence)");
    expect(out).toContain('title="Message from Lawrence Berment &lt;lawrenceb@studiopulse.tech&gt;"');
  });

  it("a plain reply gets a frame about as tall as its text; rich mail keeps the standard frame", () => {
    const short = frameHeight("<p>Thanks</p>", "Thanks Lawrence.\n\nThursday works.\n\nDana");
    expect(short).toBeGreaterThanOrEqual(120);
    expect(short).toBeLessThan(420);
    expect(frameHeight("<p>x</p>", "line\n".repeat(80))).toBe(420);
    expect(frameHeight('<p>Hi</p><img src="https://x.example/a.png">', "Hi")).toBeUndefined();
    expect(frameHeight("<table><tr><td>Hi</td></tr></table>", "Hi")).toBeUndefined();
    expect(frameHeight(null, "Hi")).toBeUndefined();
    expect(frameHeight("<p>Hi</p>", null)).toBeUndefined();
  });

  it("a long history folds its middle into one line", () => {
    const many: TimelineItem[] = Array.from({ length: 9 }, (_, i) => ({ id: `event:${i}`, kind: "event" as const, at: i, direction: null, text: `step ${i}` }));
    const out = html(<ConversationTimeline items={many} />);
    expect(out).toContain(">4 earlier</button>");
    expect(out).toContain("step 0");
    expect(out).not.toContain("step 3");
    expect(out).toContain("step 8");
  });
});
