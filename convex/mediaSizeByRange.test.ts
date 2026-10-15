import { afterEach, describe, expect, it, vi } from "vitest";
import { sizeByRange } from "./media";

// R2 compresses text objects, so the HEAD behind syncMetadata has no
// Content-Length; confirmUpload falls back to a one-byte ranged GET.
describe("sizeByRange", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the full size from Content-Range", async () => {
    const fetchMock = vi.fn(async () => new Response("P", { status: 206, headers: { "content-range": "bytes 0-0/50" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sizeByRange("https://r2.example/obj")).toBe(50);
    expect(fetchMock).toHaveBeenCalledWith("https://r2.example/obj", {
      headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
    });
  });

  it("returns 0 when the object is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("NoSuchKey", { status: 404 })));
    expect(await sizeByRange("https://r2.example/missing")).toBe(0);
  });
});
