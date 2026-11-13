import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import { r2Env, setupStudios, uploadSessionFile } from "./testing/sessionDelivery.fixture";

/* R-01: session files as they behave today (upload, list, download, delete).
   These pin current behavior, so they were written and green before any
   session delivery change touched convex/sessionFiles.ts. */

describe("session files (pinned behavior)", () => {
  let s: Awaited<ReturnType<typeof setupStudios>>;
  beforeEach(async () => { r2Env(); s = await setupStudios(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("R-01 an engineer uploads and the file is listed with its name and size", async () => {
    const eng = s.as(s.A.engineer);
    const { assetId, versionId } = await uploadSessionFile(s.t, eng, s.A.sessionId, "Lead vocal.wav", "audio/wav", 4_200_000);
    const list = await eng.query(api.sessionFiles.list, { sessionId: s.A.sessionId });
    expect(list).not.toBeNull();
    expect(list!.files).toHaveLength(1);
    expect(list!.files[0]).toMatchObject({ assetId, versionId, name: "Lead vocal.wav", fileName: "Lead vocal.wav", size: 4_200_000, mimeType: "audio/wav", version: 1 });
    expect(list!.canUpload).toBe(true);
  });

  it("R-01 a signed-out caller gets null from list and an error from prepareUpload", async () => {
    await uploadSessionFile(s.t, s.as(s.A.owner), s.A.sessionId);
    expect(await s.t.query(api.sessionFiles.list, { sessionId: s.A.sessionId })).toBeNull();
    await expect(
      s.t.mutation(api.sessionFiles.prepareUpload, { sessionId: s.A.sessionId, fileName: "x.wav", mimeType: "audio/wav", size: 10 }),
    ).rejects.toThrow();
  });

  it("R-01 a member of studio B gets null for studio A's booking", async () => {
    await uploadSessionFile(s.t, s.as(s.A.owner), s.A.sessionId);
    expect(await s.as(s.B.owner).query(api.sessionFiles.list, { sessionId: s.A.sessionId })).toBeNull();
  });

  it("R-01 downloadUrl returns a signed URL for staff", async () => {
    const { versionId } = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "Mix.wav");
    const dl = await s.as(s.A.engineer).query(api.sessionFiles.downloadUrl, { versionId });
    expect(dl.url).toContain("X-Amz-Signature");
    expect(dl).toMatchObject({ fileName: "Mix.wav", mimeType: "audio/wav", expiresIn: 600 });
    await expect(s.as(s.B.owner).query(api.sessionFiles.downloadUrl, { versionId })).rejects.toThrow();
  });

  it("R-01 an engineer can delete their own file and not another member's", async () => {
    const eng = s.as(s.A.engineer);
    const mine = await uploadSessionFile(s.t, eng, s.A.sessionId, "mine.wav");
    const theirs = await uploadSessionFile(s.t, s.as(s.A.owner), s.A.sessionId, "theirs.wav");
    await expect(eng.mutation(api.sessionFiles.remove, { assetId: theirs.assetId })).rejects.toThrow(/Only the person who uploaded/);
    await eng.mutation(api.sessionFiles.remove, { assetId: mine.assetId });
    const list = await eng.query(api.sessionFiles.list, { sessionId: s.A.sessionId });
    expect(list!.files.map((f) => f.name)).toEqual(["theirs.wav"]);
  });

  it("R-01 an owner can delete any file", async () => {
    const f = await uploadSessionFile(s.t, s.as(s.A.engineer), s.A.sessionId, "eng.wav");
    await s.as(s.A.owner).mutation(api.sessionFiles.remove, { assetId: f.assetId });
    const list = await s.as(s.A.owner).query(api.sessionFiles.list, { sessionId: s.A.sessionId });
    expect(list!.files).toEqual([]);
  });
});
