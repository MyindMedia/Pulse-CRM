import { describe, it, expect, vi, afterEach } from "vitest";
import { brandEmail, ensureBranded, isBrandedHtml, extractBodyFragment, PULSE_BRAND } from "./emailLayout";
import { sendEmail } from "./email";
import { inviteEmailHtml, teammateEmailHtml } from "./emailTemplates/invite";
import { betaInviteHtml } from "./emailTemplates/betaInvite";
import { betaWelcomeHtml } from "./emailTemplates/betaWelcome";
import { betaEndingHtml } from "./emailTemplates/betaEnding";
import { activationEmailHtml } from "./emailTemplates/activation";
import { studioEmailHtml } from "./emailTemplates/layout";

const EM_DASHES = /[—–―]/;
const body = "<p>Hello there.</p>";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
});

describe("brandEmail", () => {
  const html = brandEmail({ title: "Hi", bodyHtml: body, preheader: "Preview line", footerNote: "Reason" });

  it("carries the Pulse logo as an absolute https URL on studiopulse.tech", () => {
    expect(html).toContain(`src="${PULSE_BRAND.logoUrl}"`);
    expect(PULSE_BRAND.logoUrl).toMatch(/^https:\/\/studiopulse\.tech\//);
    expect(html).toContain('alt="Pulse"');
  });

  it("carries the brand name, tagline and postal address in the footer", () => {
    expect(html).toContain("Pulse, the studio operating system");
    expect(html).toContain("835 Wilshire Blvd, Ste 500 #519, Los Angeles, CA 90017");
    expect(html).toContain("studiopulse.tech");
    expect(html).toContain("Reason");
  });

  it("uses Pulse colours and a 600px table, with explicit light-only colours", () => {
    expect(html).toContain("#0d0d10");
    expect(html).toContain("#fdb913");
    expect(html).toContain('width="600"');
    expect(html).toContain('name="color-scheme" content="light"');
    expect(html).toContain('name="supported-color-schemes" content="light"');
  });

  it("is table-based and inserts the body and preheader", () => {
    expect(html).toContain('role="presentation"');
    expect(html).toContain(body);
    expect(html).toContain("Preview line");
  });

  it("contains no em dashes or en dashes", () => {
    expect(html).not.toMatch(EM_DASHES);
  });

  it("marks itself as branded so it is never wrapped twice", () => {
    expect(isBrandedHtml(html)).toBe(true);
  });

  it("escapes the title", () => {
    expect(brandEmail({ title: "<b>x</b>", bodyHtml: body })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("ensureBranded", () => {
  it("wraps a plain fragment once", () => {
    const out = ensureBranded(body, "Subject");
    expect(out.match(/pulse-branded/g)).toHaveLength(1);
    expect(out).toContain(body);
    expect(out).toContain(PULSE_BRAND.logoUrl);
  });

  it("leaves already-branded mail untouched", () => {
    const branded = brandEmail({ title: "T", bodyHtml: body });
    expect(ensureBranded(branded, "S")).toBe(branded);
  });

  it("leaves studio-framed (tenant) mail untouched", () => {
    const tenant = studioEmailHtml({ studioName: "Acme Sound", bodyText: "Hi" });
    expect(isBrandedHtml(tenant)).toBe(true);
    expect(ensureBranded(tenant, "S")).toBe(tenant);
  });

  it("reduces a full document to its body so the frame is not nested", () => {
    const doc = `<!DOCTYPE html><html><head><title>x</title></head><body><p>In body</p></body></html>`;
    const out = ensureBranded(doc, "S");
    expect(out.match(/<!DOCTYPE/gi)).toHaveLength(1);
    expect(out.match(/<body/gi)).toHaveLength(1);
    expect(out).toContain("<p>In body</p>");
    expect(out).not.toContain("<title>x</title>");
  });

  it("extractBodyFragment returns fragments unchanged", () => {
    expect(extractBodyFragment(body)).toBe(body);
  });
});

describe("existing Pulse templates are recognised as already branded", () => {
  const cases: [string, string][] = [
    ["invite", inviteEmailHtml({ ownerName: "A", studioName: "B", inviterName: "C", acceptUrl: "https://x", logoUrl: "https://x/l.png" })],
    ["teammate", teammateEmailHtml({ memberName: "A", studioName: "B", inviterName: "C", role: "owner", acceptUrl: "https://x", logoUrl: "https://x/l.png" })],
    ["beta invite", betaInviteHtml({ accessUrl: "https://x", code: "ABCDE-FGHJK" })],
    ["beta welcome", betaWelcomeHtml({ studioName: "B", welcomeUrl: "https://x", needsSignature: false })],
    ["beta ending", betaEndingHtml({ studioName: "B", daysLeft: 3, endsOnLabel: "Oct 1", chooseUrl: "https://x" } as never)],
    ["studio (tenant)", studioEmailHtml({ studioName: "B", bodyText: "x" })],
  ];
  it.each(cases)("%s is not re-wrapped", (_name, html) => {
    expect(isBrandedHtml(html)).toBe(true);
    expect(ensureBranded(html, "S")).toBe(html);
  });

  it("existing branded templates now carry the postal address", () => {
    expect(cases[0][1]).toContain("835 Wilshire Blvd");
    expect(cases[2][1]).toContain("835 Wilshire Blvd");
  });

  it("activation is a fragment, so it is wrapped exactly once", () => {
    const frag = activationEmailHtml({ activationUrl: "https://x/activate?t=1" });
    expect(isBrandedHtml(frag)).toBe(false);
    const out = ensureBranded(frag, "Finish setting up your Pulse account");
    expect(out.match(/pulse-branded/g)).toHaveLength(1);
    expect(out).toContain("Create my login");
  });
});

describe("sendEmail branding", () => {
  function sentHtml(fetchMock: ReturnType<typeof vi.spyOn>): string {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return JSON.parse(init.body as string).html as string;
  }
  const ok = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

  it("client audience (default) is wrapped in the Pulse layout", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = ok();
    await sendEmail({ to: "a@b.com", subject: "Hi", html: body });
    expect(sentHtml(f)).toContain(PULSE_BRAND.logoUrl);
  });

  it("internal audience is sent exactly as given", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = ok();
    await sendEmail({ to: "a@b.com", subject: "Hi", html: body, audience: "internal" });
    expect(sentHtml(f)).toBe(body);
  });

  it("raw skips branding entirely", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = ok();
    await sendEmail({ to: "a@b.com", subject: "Hi", html: body, raw: true });
    expect(sentHtml(f)).toBe(body);
  });

  it("does not double-wrap already-branded client mail", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = ok();
    const branded = brandEmail({ title: "T", bodyHtml: body });
    await sendEmail({ to: "a@b.com", subject: "Hi", html: branded });
    expect(sentHtml(f)).toBe(branded);
  });

  it("strips em dashes from the subject and from wrapped copy", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const f = ok();
    await sendEmail({ to: "a@b.com", subject: "Hi — there", html: "<p>a – b</p>" });
    const sent = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.subject).not.toMatch(EM_DASHES);
    expect(sent.html).not.toMatch(EM_DASHES);
  });

  it("simulated when unconfigured, regardless of audience", async () => {
    expect(await sendEmail({ to: "a@b.com", subject: "Hi", html: body })).toBe("simulated");
  });
});
