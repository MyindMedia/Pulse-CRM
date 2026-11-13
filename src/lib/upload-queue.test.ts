import { describe, it, expect } from "vitest";
import { MAX_PARALLEL, etaText, nextToStart, queueReducer, type QueueItem } from "./upload-queue";

const add = (state: QueueItem[], ...names: string[]) =>
  queueReducer(state, { type: "add", items: names.map((n, i) => ({ id: n, name: n, size: 1000 * (i + 1) })) });

describe("queueReducer", () => {
  it("adds items as queued with nothing sent", () => {
    const s = add([], "a.wav", "b.zip");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ id: "a.wav", status: "queued", sent: 0, size: 1000 });
    expect(s[1]).toMatchObject({ id: "b.zip", status: "queued", size: 2000 });
  });

  it("start, progress and done move one item and leave the others alone", () => {
    let s = add([], "a", "b");
    s = queueReducer(s, { type: "start", id: "a", at: 5 });
    s = queueReducer(s, { type: "progress", id: "a", sent: 400 });
    expect(s[0]).toMatchObject({ status: "uploading", sent: 400, startedAt: 5 });
    expect(s[1]).toMatchObject({ status: "queued", sent: 0 });
    s = queueReducer(s, { type: "done", id: "a" });
    expect(s[0]).toMatchObject({ status: "done", sent: 1000 });
  });

  it("clamps progress to the file size and never moves backwards", () => {
    let s = add([], "a");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "progress", id: "a", sent: 5000 });
    expect(s[0].sent).toBe(1000);
    s = queueReducer(s, { type: "progress", id: "a", sent: 10 });
    expect(s[0].sent).toBe(1000);
  });

  it("a failure keeps its reason on that row only", () => {
    let s = add([], "a", "b");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "start", id: "b", at: 0 });
    s = queueReducer(s, { type: "fail", id: "a", error: "That file type is not allowed." });
    expect(s[0]).toMatchObject({ status: "failed", error: "That file type is not allowed." });
    expect(s[1].status).toBe("uploading");
  });

  it("cancel works on queued and uploading rows, and ignores late events after it", () => {
    let s = add([], "a", "b");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "cancel", id: "a" });
    s = queueReducer(s, { type: "cancel", id: "b" });
    expect(s.map((i) => i.status)).toEqual(["canceled", "canceled"]);
    s = queueReducer(s, { type: "progress", id: "a", sent: 500 });
    s = queueReducer(s, { type: "done", id: "a" });
    s = queueReducer(s, { type: "fail", id: "a", error: "late" });
    expect(s[0]).toMatchObject({ status: "canceled", sent: 0 });
    expect(s[0].error).toBeUndefined();
  });

  it("cancel does not touch a finished row", () => {
    let s = add([], "a");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "done", id: "a" });
    s = queueReducer(s, { type: "cancel", id: "a" });
    expect(s[0].status).toBe("done");
  });

  it("remove drops one row", () => {
    let s = add([], "a", "b");
    s = queueReducer(s, { type: "remove", id: "a" });
    expect(s.map((i) => i.id)).toEqual(["b"]);
  });

  it("after commit (the point of no return) cancel is ignored and the row ends done", () => {
    let s = add([], "a");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "commit", id: "a" });
    expect(s[0]).toMatchObject({ status: "uploading", committed: true });
    s = queueReducer(s, { type: "cancel", id: "a" });
    expect(s[0].status).toBe("uploading");
    s = queueReducer(s, { type: "done", id: "a" });
    expect(s[0].status).toBe("done");
  });

  it("commit only applies to an uploading row", () => {
    let s = add([], "a");
    s = queueReducer(s, { type: "commit", id: "a" });
    expect(s[0].committed).toBeUndefined();
    s = queueReducer(s, { type: "cancel", id: "a" });
    expect(s[0].status).toBe("canceled");
  });

  it("refuse adds a row that is already failed with its reason", () => {
    const s = queueReducer(add([], "a"), { type: "refuse", item: { id: "f", name: "Session folder", size: 0 }, error: "Folders cannot be uploaded. Zip it first." });
    expect(s[1]).toMatchObject({ id: "f", status: "failed", error: "Folders cannot be uploaded. Zip it first." });
    expect(nextToStart(s)).toEqual(["a"]);
  });

  it("a zero byte file can still finish", () => {
    let s = queueReducer([], { type: "add", items: [{ id: "z", name: "z.txt", size: 0 }] });
    s = queueReducer(s, { type: "start", id: "z", at: 0 });
    s = queueReducer(s, { type: "done", id: "z" });
    expect(s[0]).toMatchObject({ status: "done", sent: 0 });
  });
});

describe("nextToStart", () => {
  it("allows at most MAX_PARALLEL uploads at once, oldest first", () => {
    expect(MAX_PARALLEL).toBe(2);
    let s = add([], "a", "b", "c", "d");
    expect(nextToStart(s)).toEqual(["a", "b"]);
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    expect(nextToStart(s)).toEqual(["b"]);
    s = queueReducer(s, { type: "start", id: "b", at: 0 });
    expect(nextToStart(s)).toEqual([]);
  });

  it("a canceled or failed upload frees a slot and the others keep going", () => {
    let s = add([], "a", "b", "c");
    s = queueReducer(s, { type: "start", id: "a", at: 0 });
    s = queueReducer(s, { type: "start", id: "b", at: 0 });
    s = queueReducer(s, { type: "cancel", id: "a" });
    expect(nextToStart(s)).toEqual(["c"]);
    s = queueReducer(s, { type: "start", id: "c", at: 0 });
    s = queueReducer(s, { type: "fail", id: "b", error: "x" });
    expect(s.find((i) => i.id === "c")?.status).toBe("uploading");
    expect(nextToStart(s)).toEqual([]);
  });
});

describe("etaText", () => {
  const MB = 1024 * 1024;
  it("is empty before two seconds of data", () => {
    expect(etaText(1 * MB, 100 * MB, 0, 1999)).toBe("");
    expect(etaText(0, 100 * MB, 0, 5000)).toBe("");
  });
  it("says a few seconds when the end is near", () => {
    expect(etaText(90 * MB, 100 * MB, 0, 9000)).toBe("a few seconds left");
  });
  it("counts minutes", () => {
    // 10 MB in 10 s = 1 MB/s; 120 MB left = 120 s = 2 min
    expect(etaText(10 * MB, 130 * MB, 0, 10_000)).toBe("about 2 min left");
    expect(etaText(10 * MB, 70 * MB, 0, 10_000)).toBe("about 1 min left");
  });
  it("counts hours for very slow links", () => {
    expect(etaText(1 * MB, 20_000 * MB, 0, 10_000)).toMatch(/^about \d+ hr left$/);
  });
  it("is empty when finished or the clock is odd", () => {
    expect(etaText(100, 100, 0, 9000)).toBe("");
    expect(etaText(50, 100, 9000, 3000)).toBe("");
  });
});
