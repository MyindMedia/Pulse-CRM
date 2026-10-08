import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { svixSign } from "./mail/svix";
import r2Test from "@convex-dev/r2/test";
import { R2 } from "@convex-dev/r2";

const AG = "org_mail";
const OTHER = "org_other";
const SECRET = "whsec_" + btoa("test-webhook-signing-secret-0123456");
const idOf = (s: string, o: string) => ({ subject: s, name: s, orgId: o, orgType: "agency" });

type Received = Record<string, unknown>;

describe("agency email", () => {
  let t: ReturnType<typeof convexTest>;
  const as = (s: string, o = AG) => t.withIdentity(idOf(s, o) as never);

  beforeEach(() => {
    vi.useFakeTimers();
    t = convexTest(schema);
    vi.stubEnv("MAIL_AGENCY_ID", AG);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("RESEND_API_KEY", "re_test_key_value_123456");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  async function seedAgency() {
    await t.run(async (ctx) => {
      for (const ag of [AG, OTHER]) {
        await ctx.db.insert("agencies", { agencyId: ag, name: ag, slug: ag, plan: "max", status: "active", ownerClerkUserId: `owner_${ag}`, ownerEmail: "o@x" });
        await ctx.db.insert("agencyMembers", { agencyId: ag, clerkUserId: `owner_${ag}`, email: "o@x", name: "o", role: "owner", status: "active", invitedAt: 0 });
      }
      await ctx.db.insert("agencyMembers", { agencyId: AG, clerkUserId: "staff", email: "s@x", name: "s", role: "staff", status: "active", invitedAt: 0 });
    });
    await as(`owner_${AG}`).mutation(api.mail.ensureDefaults, {});
  }
  const owner = () => as(`owner_${AG}`);

  /** Stubs Resend: the received-email fetch returns `full` for each id. */
  function stubResend(full: Record<string, Received | null>, sendStatus = 200) {
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const m = /emails\/receiving\/([^/]+)(\/attachments)?$/.exec(url);
      if (m && m[2]) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (m) {
        const body = full[decodeURIComponent(m[1])];
        return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 500 });
      }
      if (url === "https://api.resend.com/emails" && init?.method === "POST") return new Response(JSON.stringify({ id: "sent-1" }), { status: sendStatus });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", f);
    return f;
  }

  async function post(event: unknown, opts: { secret?: string; tamper?: boolean; ts?: number } = {}) {
    const body = JSON.stringify(event);
    const ts = String(Math.floor((opts.ts ?? Date.now()) / 1000));
    const sig = await svixSign(opts.secret ?? SECRET, "msg_x", ts, body);
    return await t.fetch("/resend/inbound", {
      method: "POST",
      headers: { "Content-Type": "application/json", "svix-id": "msg_x", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
      body: opts.tamper ? body.replace("email.received", "email.receivedX") : body,
    });
  }

  const event = (id: string, to: string[], subject = "Studio booking", extra: Record<string, unknown> = {}) => ({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: id, from: "Jane Doe <jane@client.com>", to, cc: [], received_for: to, message_id: `<${id}@client.com>`, subject, attachments: [], ...extra },
  });
  const full = (id: string, to: string[], subject = "Studio booking", headers: Record<string, string> = {}): Received => ({
    id, from: "Jane Doe <jane@client.com>", to, cc: [], subject, text: `Body of ${id}`, html: `<p>Body of ${id}</p><img src="data:image/png;base64,AAAA">`,
    headers, message_id: `<${id}@client.com>`, created_at: new Date().toISOString(), attachments: [],
  });

  async function boxId(address: string): Promise<Id<"mailboxes">> {
    const list = await owner().query(api.mail.listMailboxes, {});
    return list!.mailboxes.find((m) => m.address === address)!._id;
  }

  /* ------------------------------ webhook gate ------------------------------ */

  it("returns 503 when the webhook secret is unset (fails closed)", async () => {
    await seedAgency();
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const res = await post(event("e0", ["support@studiopulse.tech"]));
    expect(res.status).toBe(503);
  });

  it("returns 503 when no agency owns the mail", async () => {
    vi.stubEnv("MAIL_AGENCY_ID", "");
    vi.stubEnv("OUTREACH_INTAKE_AGENCY_ID", "");
    expect((await post(event("e0", ["support@studiopulse.tech"]))).status).toBe(503);
  });

  it("refuses a bad signature, a wrong secret and a stale timestamp, storing nothing", async () => {
    await seedAgency();
    const f = stubResend({});
    expect((await post(event("e1", ["support@studiopulse.tech"]), { tamper: true })).status).toBe(401);
    expect((await post(event("e1", ["support@studiopulse.tech"]), { secret: "whsec_" + btoa("wrong-secret-wrong-secret-wrong") })).status).toBe(401);
    expect((await post(event("e1", ["support@studiopulse.tech"]), { ts: Date.now() - 10 * 60 * 1000 })).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
    expect(await t.run(async (ctx) => (await ctx.db.query("mailMessages").collect()).length)).toBe(0);
  });

  /* ------------------------------ ingest ------------------------------ */

  it("stores a valid message in the right mailbox, fetching the body, and dedupes retries", async () => {
    await seedAgency();
    stubResend({ e1: full("e1", ["support@studiopulse.tech"]) });
    const res = await post(event("e1", ["support@studiopulse.tech"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "stored", routed: true });
    expect((await post(event("e1", ["support@studiopulse.tech"]))).status).toBe(200);

    const msgs = await t.run(async (ctx) => await ctx.db.query("mailMessages").collect());
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe("Body of e1");
    expect(msgs[0].html).not.toContain("data:image");
    expect(msgs[0].bodyStatus).toBe("ok");
    expect(msgs[0].mailboxId).toBe(await boxId("support@studiopulse.tech"));

    const boxes = await owner().query(api.mail.listMailboxes, {});
    expect(boxes!.mailboxes.find((m) => m.address === "support@studiopulse.tech")!.unread).toBe(1);
  });

  it("the ingest mutation itself dedupes by Resend id", async () => {
    await seedAgency();
    const msg = {
      resendEmailId: "dup", from: "a@x.com", to: ["support@studiopulse.tech"], cc: [], replyTo: [], receivedFor: [], subject: "s",
      references: [], receivedAt: Date.now(), attachments: [], bodyStatus: "ok" as const,
    };
    expect((await t.mutation(internal.mail._ingest, { agencyId: AG, msg })).status).toBe("stored");
    expect((await t.mutation(internal.mail._ingest, { agencyId: AG, msg })).status).toBe("duplicate");
  });

  it("routes by recipient: lawrenceb@ and info@ to their boxes, an unknown address to Unrouted", async () => {
    await seedAgency();
    stubResend({
      a: full("a", ["lawrenceb@studiopulse.tech"], "For Lawrence"),
      b: full("b", ["info@studiopulse.tech"], "Re: Your studio has a sound"),
      c: full("c", ["sales@studiopulse.tech"], "Hello sales"),
    });
    await post(event("a", ["lawrenceb@studiopulse.tech"], "For Lawrence"));
    await post(event("b", ["info@studiopulse.tech"], "Re: Your studio has a sound"));
    const res = await post(event("c", ["sales@studiopulse.tech"], "Hello sales"));
    expect(await res.json()).toMatchObject({ status: "stored", routed: false });

    const lb = await owner().query(api.mail.listThreads, { box: await boxId("lawrenceb@studiopulse.tech") });
    expect(lb!.map((x) => x.subject)).toEqual(["For Lawrence"]);
    const info = await owner().query(api.mail.listThreads, { box: await boxId("info@studiopulse.tech") });
    expect(info!.map((x) => x.subject)).toEqual(["Re: Your studio has a sound"]);
    const unrouted = await owner().query(api.mail.listThreads, { box: "unrouted" });
    expect(unrouted!.map((x) => x.subject)).toEqual(["Hello sales"]);
    expect(unrouted![0].originalRecipients).toEqual(["sales@studiopulse.tech"]);

    await owner().mutation(api.mail.moveThread, { threadId: unrouted![0]._id, mailboxId: await boxId("support@studiopulse.tech") });
    expect(await owner().query(api.mail.listThreads, { box: "unrouted" })).toEqual([]);
  });

  it("threads by In-Reply-To, by References, and by subject + sender", async () => {
    await seedAgency();
    stubResend({
      t1: full("t1", ["support@studiopulse.tech"], "Session on Friday"),
      t2: full("t2", ["support@studiopulse.tech"], "Re: Session on Friday", { "In-Reply-To": "<t1@client.com>" }),
      t3: full("t3", ["support@studiopulse.tech"], "Changed subject", { References: "<t1@client.com> <t2@client.com>" }),
      t4: full("t4", ["support@studiopulse.tech"], "RE: session on friday"),
      t5: { ...full("t5", ["support@studiopulse.tech"], "Session on Friday"), from: "Bob <bob@else.com>" },
    });
    for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
      await post({ ...event(id, ["support@studiopulse.tech"]), data: { ...event(id, ["support@studiopulse.tech"]).data, from: id === "t5" ? "Bob <bob@else.com>" : "Jane Doe <jane@client.com>" } });
    }
    const threads = await owner().query(api.mail.listThreads, { box: await boxId("support@studiopulse.tech") });
    expect(threads).toHaveLength(2);
    const jane = threads!.find((x) => x.participants.includes("jane@client.com"))!;
    expect(jane.messageCount).toBe(4);
    expect(jane.unreadCount).toBe(4);
    await owner().mutation(api.mail.markThreadRead, { threadId: jane._id });
    const after = await owner().query(api.mail.listMailboxes, {});
    expect(after!.mailboxes.find((m) => m.address === "support@studiopulse.tech")!.unread).toBe(1);
  });

  it("keeps a metadata-only message when the body fetch fails, then fills it in and copies no bytes to Convex storage", async () => {
    await seedAgency();
    const bodies: Record<string, Received | null> = { late: null };
    stubResend(bodies);
    const ev = event("late", ["support@studiopulse.tech"], "Invoice", { attachments: [{ id: "att1", filename: "inv.pdf", content_type: "application/pdf", content_disposition: null, content_id: null }] });
    expect((await post(ev)).status).toBe(200);
    let m = await t.run(async (ctx) => (await ctx.db.query("mailMessages").collect())[0]);
    expect(m.bodyStatus).toBe("pending");
    expect(m.attachments[0]).toMatchObject({ filename: "inv.pdf", status: "pending" });

    bodies.late = { ...full("late", ["support@studiopulse.tech"], "Invoice"), attachments: [{ id: "att1", filename: "inv.pdf", content_type: "application/pdf", size: 10 }] };
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    m = await t.run(async (ctx) => (await ctx.db.query("mailMessages").collect())[0]);
    expect(m.bodyStatus).toBe("ok");
    expect(m.text).toBe("Body of late");
    // The attachment listing returns no download link here, so it is marked, never silently dropped.
    expect(m.attachments[0].status).toBe("failed");
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(0);
  });

  it("stores an attachment as a forced download of octet-stream, whatever type the sender declared", async () => {
    await seedAgency();
    r2Test.register(t);
    for (const [k, val] of Object.entries({
      R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "AKIATEST",
      R2_SECRET_ACCESS_KEY: "secret-test-value", R2_PRIVATE_BUCKET: "pulse-private", R2_MEDIA_BUCKET: "pulse-media", R2_KEY_PREFIX: "test",
    })) vi.stubEnv(k, val);
    const puts: Array<{ type?: string; disposition?: string }> = [];
    const store = vi.spyOn(R2.prototype, "store").mockImplementation(async (_ctx, _file, opts) => {
      const o = typeof opts === "string" ? { key: opts } : (opts ?? {});
      puts.push({ type: o.type, disposition: o.disposition });
      return o.key!;
    });
    const html = "<html><script>alert(document.domain)</script></html>";
    const msg = { ...full("att", ["support@studiopulse.tech"], "Invoice"), attachments: [{ id: "a1", filename: "invoice.html", content_type: "text/html", size: html.length }] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/emails/receiving/att")) return new Response(JSON.stringify(msg), { status: 200 });
      if (url.endsWith("/emails/receiving/att/attachments")) {
        return new Response(JSON.stringify({ data: [{ id: "a1", size: html.length, download_url: "https://cdn.resend.test/a1", content_type: "text/html", filename: "invoice.html" }] }), { status: 200 });
      }
      if (url === "https://cdn.resend.test/a1") return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
      return new Response("not found", { status: 404 });
    }));
    try {
      expect((await post(event("att", ["support@studiopulse.tech"], "Invoice"))).status).toBe(200);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const m = await t.run(async (ctx) => (await ctx.db.query("mailMessages").collect())[0]);
      expect(m.attachments[0]).toMatchObject({ status: "stored", contentType: "text/html", filename: "invoice.html" });
      expect(puts).toEqual([{ type: "application/octet-stream", disposition: 'attachment; filename="invoice.html"' }]);
      const file = await t.run(async (ctx) => await ctx.db.get(m.attachments[0].fileRef as Id<"mediaFiles">));
      expect(file!.mimeType).toBe("application/octet-stream");
    } finally {
      store.mockRestore();
    }
  });

  it("a sender's attachments get no upload exemptions: the daily upload limit applies to them", async () => {
    r2Test.register(t);
    for (const [k, val] of Object.entries({
      R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", R2_ACCESS_KEY_ID: "AKIATEST",
      R2_SECRET_ACCESS_KEY: "secret-test-value", R2_PRIVATE_BUCKET: "pulse-private", R2_MEDIA_BUCKET: "pulse-media", R2_KEY_PREFIX: "test",
    })) vi.stubEnv(k, val);
    const scope = `agency:${AG}`;
    await t.run(async (ctx) => {
      for (let i = 0; i < 300; i++) {
        await ctx.db.insert("mediaFiles", { orgId: scope, bucket: "private", key: `test/${scope}/document/f${i}`, purpose: "document", fileName: "f", mimeType: "application/octet-stream", status: "ready", uploadedBy: "mail-inbound", createdAt: Date.now() });
      }
    });
    const reserve = (trusted?: boolean) => t.mutation(internal.media._reserveStored, {
      scope, purpose: "document", fileName: "x.bin", mimeType: "application/octet-stream", size: 10, actor: "mail-inbound", ...(trusted === undefined ? {} : { trusted }),
    });
    await expect(reserve(false)).rejects.toThrow(/Too many uploads/);
    // Our own server-side writes (backfills, generated images) keep the exemption.
    await expect(reserve()).resolves.toMatchObject({ bucket: "private" });
  });

  /* ------------------------------ access ------------------------------ */

  it("only owners and admins of the mail agency can read or create", async () => {
    await seedAgency();
    expect(await as("staff").query(api.mail.listMailboxes, {})).toBeNull();
    expect(await as(`owner_${OTHER}`, OTHER).query(api.mail.listMailboxes, {})).toBeNull();
    await expect(as(`owner_${OTHER}`, OTHER).mutation(api.mail.createMailbox, { localPart: "hijack", displayName: "x" })).rejects.toThrow(/Only an owner or admin/);
    await expect(as("staff").mutation(api.mail.ensureDefaults, {})).rejects.toThrow();
    expect((await as(`owner_${OTHER}`, OTHER).query(api.mail.access, {})).allowed).toBe(false);
    expect((await owner().query(api.mail.access, {})).allowed).toBe(true);
  });

  it("quarantines mail to domain role addresses instead of showing it in Unrouted", async () => {
    await seedAgency();
    stubResend({
      q1: full("q1", ["admin@studiopulse.tech"], "Verify your domain"),
      q2: full("q2", ["postmaster@studiopulse.tech"], "Hello sales"),
      u1: full("u1", ["sales@studiopulse.tech"], "Hello sales"),
    });
    await post(event("q1", ["admin@studiopulse.tech"], "Verify your domain"));
    await post(event("u1", ["sales@studiopulse.tech"], "Hello sales"));
    // Same subject and sender as an open Unrouted thread: must not join or reopen it.
    await post(event("q2", ["postmaster@studiopulse.tech"], "Hello sales"));

    const unrouted = await owner().query(api.mail.listThreads, { box: "unrouted" });
    expect(unrouted!.map((x) => x.subject)).toEqual(["Hello sales"]);
    expect(unrouted![0].messageCount).toBe(1);
    expect(await owner().query(api.mail.listThreads, { box: "unrouted", archived: true })).toEqual([]);
    expect((await owner().query(api.mail.listMailboxes, {}))!.unroutedUnread).toBe(1);

    // Kept, not dropped.
    const threads = await t.run(async (ctx) => await ctx.db.query("mailThreads").collect());
    expect(threads.filter((x) => x.status === "quarantined").map((x) => x.subject).sort()).toEqual(["Hello sales", "Verify your domain"]);
    expect(await t.run(async (ctx) => (await ctx.db.query("mailMessages").collect()).length)).toBe(3);
  });

  it("seeds Support, Lawrence B and Info once", async () => {
    await seedAgency();
    expect(await owner().mutation(api.mail.ensureDefaults, {})).toBe(0);
    const list = await owner().query(api.mail.listMailboxes, {});
    expect(list!.mailboxes.map((m) => [m.address, m.displayName])).toEqual([
      ["support@studiopulse.tech", "Support"],
      ["lawrenceb@studiopulse.tech", "Lawrence B"],
      ["info@studiopulse.tech", "Info"],
    ]);
  });

  it("new inbox validation: lowercase, fixed domain, no duplicates, no reserved names", async () => {
    await seedAgency();
    const made = await owner().mutation(api.mail.createMailbox, { localPart: "bookings", displayName: "Bookings" });
    expect(made.address).toBe("bookings@studiopulse.tech");
    await expect(owner().mutation(api.mail.createMailbox, { localPart: "bookings", displayName: "Again" })).rejects.toThrow(/already exists/);
    await expect(owner().mutation(api.mail.createMailbox, { localPart: "support", displayName: "Dup" })).rejects.toThrow(/already exists/);
    await expect(owner().mutation(api.mail.createMailbox, { localPart: "postmaster", displayName: "P" })).rejects.toThrow(/reserved/);
    await expect(owner().mutation(api.mail.createMailbox, { localPart: "Big", displayName: "B" })).rejects.toThrow(/lowercase/);
    await expect(owner().mutation(api.mail.createMailbox, { localPart: "x@gmail.com", displayName: "B" })).rejects.toThrow(/studiopulse.tech/);
  });

  /* ------------------------------ outbound ------------------------------ */

  it("a reply goes out from the mailbox with In-Reply-To and References", async () => {
    await seedAgency();
    const f = stubResend({
      r1: full("r1", ["lawrenceb@studiopulse.tech"], "Mix notes"),
      r2: full("r2", ["lawrenceb@studiopulse.tech"], "Re: Mix notes", { "In-Reply-To": "<r1@client.com>", References: "<r1@client.com>" }),
    });
    await post(event("r1", ["lawrenceb@studiopulse.tech"], "Mix notes"));
    await post(event("r2", ["lawrenceb@studiopulse.tech"], "Re: Mix notes"));
    const lb = await boxId("lawrenceb@studiopulse.tech");
    const [thread] = (await owner().query(api.mail.listThreads, { box: lb }))!;
    await owner().mutation(api.mail.send, { mailboxId: lb, threadId: thread._id, to: ["jane@client.com"], body: "Sounds good — talk Friday." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const call = f.mock.calls.find(([u, i]) => String(u) === "https://api.resend.com/emails" && i?.method === "POST")!;
    const sent = JSON.parse(String(call[1]!.body));
    expect(sent.from).toBe("Lawrence Berment <lawrenceb@studiopulse.tech>");
    expect(sent.subject).toBe("Re: Mix notes");
    expect(sent.headers).toEqual({ "In-Reply-To": "<r2@client.com>", References: "<r1@client.com> <r2@client.com>" });
    expect(sent.text).not.toMatch(/—/);
    expect(sent.attachments[0].content_id).toBe("pulse-signature-lawrence");
    expect((call[1]!.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^pulse-mail-/);

    const view = await owner().query(api.mail.getThread, { threadId: thread._id });
    const out = view!.messages.find((m) => m.direction === "out")!;
    expect(out.sendStatus).toBe("accepted");
  });

  it("refuses to reply from a different mailbox than the thread's, and refuses bad recipients", async () => {
    await seedAgency();
    stubResend({ x1: full("x1", ["support@studiopulse.tech"], "Q") });
    await post(event("x1", ["support@studiopulse.tech"], "Q"));
    const [thread] = (await owner().query(api.mail.listThreads, { box: await boxId("support@studiopulse.tech") }))!;
    await expect(owner().mutation(api.mail.send, { mailboxId: await boxId("info@studiopulse.tech"), threadId: thread._id, to: ["jane@client.com"], body: "x" })).rejects.toThrow(/Move it there first/);
    await expect(owner().mutation(api.mail.send, { mailboxId: await boxId("support@studiopulse.tech"), to: ["not-an-address"], subject: "s", body: "x" })).rejects.toThrow(/not an email address/);
  });
});
