import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { allowClerkIdentifier } from "./clerkAllowlist";

/* The Clerk allowlist is the difference between an invited studio owner
   creating an account and being told, with a signed agreement in hand, that
   he is "not allowed to access this application". These tests hold the two
   properties that matter: we call Clerk when we can, and we never blow up
   the invite when we cannot. */

const realFetch = globalThis.fetch;
const realKey = process.env.CLERK_SECRET_KEY;

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(impl);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  process.env.CLERK_SECRET_KEY = "sk_test_key";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = realKey;
  vi.restoreAllMocks();
});

describe("allowClerkIdentifier", () => {
  it("posts the identifier to Clerk", async () => {
    const spy = stubFetch(() => new Response("{}", { status: 200 }));
    expect(await allowClerkIdentifier(" owner@studio.com ")).toBe("added");

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.clerk.com/v1/allowlist_identifiers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: "owner@studio.com",   // trimmed
      notify: false,                    // our invite is the only mail they get
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_key");
  });

  it("treats an identifier already on the list as success", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ errors: [{ code: "duplicate_record" }] }),
          { status: 400 },
        ),
    );
    expect(await allowClerkIdentifier("owner@studio.com")).toBe("already");
  });

  it("reports a real Clerk failure without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(await allowClerkIdentifier("owner@studio.com")).toBe("failed");
  });

  it("survives the network dropping - the invite is already sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(() => {
      throw new Error("connection lost");
    });
    expect(await allowClerkIdentifier("owner@studio.com")).toBe("failed");
  });

  it("does nothing without a key or an identifier", async () => {
    const spy = stubFetch(() => new Response("{}", { status: 200 }));
    expect(await allowClerkIdentifier("   ")).toBe("skipped");

    delete process.env.CLERK_SECRET_KEY;
    expect(await allowClerkIdentifier("owner@studio.com")).toBe("skipped");
    expect(spy).not.toHaveBeenCalled();
  });
});
